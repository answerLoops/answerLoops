// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotionKBSection } from '@/app/(dashboard)/kb/page'

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

  it('the publish toggle PATCHes /api/kb/sources/:id with { published: 1 } when going from unpublished', async () => {
    mockFetch.mockImplementation(
      routeFetch({ conn: connectedConn, sources: [notionSource({ published: 0 })] }),
    )
    const user = userEvent.setup()
    render(<NotionKBSection onSynced={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /publish to widget/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /publish to widget/i }))

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.startsWith('/api/kb/sources/'),
      )
      expect(patchCall).toBeTruthy()
      expect(patchCall![0]).toBe('/api/kb/sources/42')
      expect(patchCall![1].method).toBe('PATCH')
      expect(JSON.parse(patchCall![1].body)).toEqual({ published: 1 })
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
