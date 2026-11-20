// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotionKBSection } from '@/components/dashboard/notion-kb-section'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: vi.fn() }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function notionSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    filename: 'notion',
    file_type: 'notion',
    published: 1,
    chunk_count: 8,
    size_bytes: 2048,
    ...overrides,
  }
}

function routeFetch({
  conn = null,
  sources = [],
  syncJob = null,
  patchOk = true,
}: {
  conn?: unknown
  sources?: unknown[]
  syncJob?: { status: string; detail?: string; syncedCount?: number } | null
  patchOk?: boolean
} = {}) {
  return vi.fn((url: string, opts?: { method?: string; body?: string }) => {
    if (url.startsWith('/api/kb/sync-jobs')) {
      return Promise.resolve({ ok: true, json: async () => syncJob })
    }
    if (url.startsWith('/api/notion/sync-kb')) {
      expect(opts?.method).toBe('POST')
      return Promise.resolve({ ok: true, json: async () => ({ jobId: 1, status: 'queued' }) })
    }
    if (url.startsWith('/api/notion')) {
      return Promise.resolve({ ok: true, json: async () => ({ connection: conn }) })
    }
    if (url.startsWith('/api/kb/sources/')) {
      expect(opts?.method).toBe('PATCH')
      return Promise.resolve({ ok: patchOk, status: patchOk ? 204 : 500, json: async () => ({ ok: patchOk }) })
    }
    if (url.startsWith('/api/kb/sources')) {
      return Promise.resolve({ ok: true, json: async () => sources })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

const connectedConn = { workspace_name: 'Acme HQ', kb_last_synced: null, kb_chunk_count: 8 }

describe('NotionKBSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing while the connection is still loading', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})) // never resolves
    const { container } = render(<NotionKBSection onSynced={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a "Connect Notion" prompt when /api/notion reports no connection', async () => {
    mockFetch.mockImplementation(routeFetch({ conn: null }))
    render(<NotionKBSection onSynced={vi.fn()} />)

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/notion'))
    await waitFor(() => expect(screen.getByText('Connect Notion →')).toBeTruthy())
    // no sync/publish controls until connected
    expect(screen.queryByRole('button', { name: /sync now/i })).toBeNull()
  })

  it('shows "Not visible to the website widget" and a "Publish to widget" button for an unpublished notion source', async () => {
    mockFetch.mockImplementation(
      routeFetch({ conn: connectedConn, sources: [notionSource({ published: 0 })] }),
    )
    render(<NotionKBSection onSynced={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Not visible to the website widget')).toBeTruthy())
    expect(screen.getByRole('button', { name: /publish to widget/i })).toBeTruthy()
    expect(screen.queryByText('Live on the website widget')).toBeNull()
  })

  it('shows "Live on the website widget" and an "Unpublish" button for a published notion source', async () => {
    mockFetch.mockImplementation(
      routeFetch({ conn: connectedConn, sources: [notionSource({ published: 1 })] }),
    )
    render(<NotionKBSection onSynced={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Live on the website widget')).toBeTruthy())
    expect(screen.getByRole('button', { name: /^unpublish$/i })).toBeTruthy()
  })

  const patchCalls = () =>
    mockFetch.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/kb/sources/'))

  async function openPublishConfirm(sourceOverrides: Record<string, unknown> = { published: 0 }, conn: unknown = connectedConn) {
    mockFetch.mockImplementation(routeFetch({ conn, sources: [notionSource(sourceOverrides)] }))
    const user = userEvent.setup()
    const onSynced = vi.fn()
    render(<NotionKBSection onSynced={onSynced} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /publish to widget/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /publish to widget/i }))
    return { user, onSynced }
  }

  it('asks before publishing: nothing is sent until the person confirms', async () => {
    await openPublishConfirm()

    const panel = screen.getByRole('group', { name: /confirm publishing/i })
    expect(panel).toBeTruthy()
    expect(screen.getByText(/8 chunks will go live/i)).toBeTruthy()
    expect(screen.getByText(/shared with your Notion integration/i)).toBeTruthy()
    expect(patchCalls()).toHaveLength(0)
  })

  it('confirming PATCHes /api/kb/sources/:id with { published: 1 }, closes the prompt and refreshes', async () => {
    const { user, onSynced } = await openPublishConfirm()

    await user.click(screen.getByRole('button', { name: /yes, publish/i }))

    await waitFor(() => {
      expect(patchCalls()).toHaveLength(1)
      expect(patchCalls()[0][0]).toBe('/api/kb/sources/42')
      expect(patchCalls()[0][1].method).toBe('PATCH')
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ published: 1 })
    })
    await waitFor(() => expect(onSynced).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: /confirm publishing/i })).toBeNull()
  })

  it('cancelling closes the prompt without sending anything', async () => {
    const { user } = await openPublishConfirm()

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.queryByRole('group', { name: /confirm publishing/i })).toBeNull()
    expect(patchCalls()).toHaveLength(0)
    expect(screen.getByRole('button', { name: /publish to widget/i })).not.toBeDisabled()
  })

  it('Escape closes the prompt without sending anything', async () => {
    const { user } = await openPublishConfirm()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('group', { name: /confirm publishing/i })).toBeNull()
    expect(patchCalls()).toHaveLength(0)
  })

  it('focuses Cancel, not the publishing action, when the prompt opens', async () => {
    await openPublishConfirm()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^cancel$/i }))
  })

  it('disables the publish button while the prompt is open', async () => {
    await openPublishConfirm()
    expect(screen.getByRole('button', { name: /publish to widget/i })).toBeDisabled()
  })

  it('uses the singular for a single chunk', async () => {
    await openPublishConfirm({ published: 0 }, { ...connectedConn, kb_chunk_count: 1 })
    expect(screen.getByText(/1 chunk will go live/i)).toBeTruthy()
  })

  it('leaves the chunk count out of the prompt when none has been counted', async () => {
    await openPublishConfirm({ published: 0 }, { ...connectedConn, kb_chunk_count: 0 })
    expect(screen.queryByText(/will go live/i)).toBeNull()
    expect(screen.getByText(/shared with your Notion integration/i)).toBeTruthy()
  })

  it('shows an error and no longer asks when the publish request fails', async () => {
    mockFetch.mockImplementation(
      routeFetch({ conn: connectedConn, sources: [notionSource({ published: 0 })], patchOk: false }),
    )
    const user = userEvent.setup()
    render(<NotionKBSection onSynced={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /publish to widget/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /publish to widget/i }))
    await user.click(screen.getByRole('button', { name: /yes, publish/i }))

    await waitFor(() => expect(screen.getByText('Could not update publish state')).toBeTruthy())
    expect(screen.queryByRole('group', { name: /confirm publishing/i })).toBeNull()
  })

  it('unpublishing needs no confirmation: one click PATCHes { published: 0 }', async () => {
    mockFetch.mockImplementation(
      routeFetch({ conn: connectedConn, sources: [notionSource({ published: 1 })] }),
    )
    const user = userEvent.setup()
    render(<NotionKBSection onSynced={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /^unpublish$/i })).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /^unpublish$/i }))

    expect(screen.queryByRole('group', { name: /confirm publishing/i })).toBeNull()
    await waitFor(() => {
      expect(patchCalls()).toHaveLength(1)
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ published: 0 })
    })
  })

  it('disables the publish button when connected but no notion source row exists yet', async () => {
    mockFetch.mockImplementation(
      routeFetch({ conn: { ...connectedConn, kb_chunk_count: 0 }, sources: [] }),
    )
    render(<NotionKBSection onSynced={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Not yet synced')).toBeTruthy())
    expect(screen.getByRole('button', { name: /publish to widget/i })).toBeDisabled()
  })

  it('"Sync now" enqueues via POST /api/notion/sync-kb, polls the job, and calls onSynced on success', async () => {
    const onSynced = vi.fn()
    mockFetch.mockImplementation(
      routeFetch({
        conn: connectedConn,
        sources: [notionSource()],
        syncJob: { status: 'succeeded', detail: 'Synced 3 chunks from Notion', syncedCount: 3 },
      }),
    )
    const user = userEvent.setup()
    render(<NotionKBSection onSynced={onSynced} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /sync now/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /sync now/i }))

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([u, o]) => u === '/api/notion/sync-kb' && o?.method === 'POST'),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([u]) => typeof u === 'string' && u.startsWith('/api/kb/sync-jobs'))).toBe(true),
    )
    await waitFor(() => expect(onSynced).toHaveBeenCalled())
  })
})
