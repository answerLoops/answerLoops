// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The KB page's Sources tab layout: add-content buttons in the header that
 * open dialogs, a row of counts, and one Sources list that also carries the
 * sync control for each connected GitHub repository.
 */

const h = vi.hoisted(() => ({ fetchMock: vi.fn(), runKbSync: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('@/app/(dashboard)/kb/review-tab', () => ({ ReviewTab: () => <div /> }))
vi.mock('@/app/(dashboard)/kb/coverage-tab', () => ({ CoverageTab: () => <div /> }))
vi.mock('@/components/dashboard/notion-kb-section', () => ({ NotionKBSection: () => <div /> }))
vi.mock('@/components/dashboard/add-knowledge-section', () => ({
  AddKnowledgeSection: () => <div data-testid="add-knowledge-section" />,
}))
vi.mock('@/lib/actions/kb', () => ({ getTicketDraftAction: vi.fn() }))
vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: vi.fn() }))
vi.mock('@/lib/kb/sync-client', () => ({ runKbSync: h.runKbSync }))

vi.stubGlobal('fetch', h.fetchMock)

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)

const source = (id: number, filename: string, file_type: string, chunk_count: number) => ({
  id, org_id: 1, filename, file_type, size_bytes: 1024, chunk_count, published: 1, created_at: '', updated_at: '',
})
const repo = {
  id: 5, owner: 'acme', repo: 'docs', kb_enabled: 1, kb_chunk_count: 240, kb_last_synced: '2026-11-24T00:00:00Z',
  kb_synced_commit: null, kb_paths: ['docs'], kb_sync_result: null,
}

function route() {
  h.fetchMock.mockImplementation((url: string) => {
    if (url === '/api/kb/review?limit=0') return json({ counts: { pending: 7 } })
    if (url === '/api/kb/flags?limit=0') return json({ counts: { open: 0 } })
    if (url === '/api/kb') return json([])
    if (url === '/api/kb/sources') {
      return json([source(1, 'acme/docs', 'github', 240), source(2, 'https://acme.test/about', 'url', 4)])
    }
    if (url === '/api/github/repos') return json([repo])
    return json({})
  })
}

async function renderPage() {
  const { default: KBPage } = await import('@/app/(dashboard)/kb/page')
  render(<KBPage />)
  await waitFor(() => expect(screen.getByText('acme/docs')).toBeTruthy())
  await act(async () => {})
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  route()
})

describe('KB page: Sources layout', () => {
  it('shows counts for sources, chunks and questions needing review', async () => {
    await renderPage()
    const count = (label: string) =>
      screen.getAllByText(label).find((el) => el.className.includes('text-xs text-slate-500'))?.nextElementSibling?.textContent
    expect(count('Sources')).toBe('2')
    expect(count('Chunks')).toBe('244')
    expect(count('Needs review')).toBe('7')
  })

  it('opens each add-content dialog from the header and closes it with Escape', async () => {
    await renderPage()
    expect(screen.queryByRole('dialog')).toBeNull()
    for (const [button, title] of [
      ['+ Write answer', 'Write an answer'],
      ['Upload file', 'Upload file'],
      ['Import URL', 'Import from URL'],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: button }))
      expect(screen.getByRole('dialog', { name: title })).toBeTruthy()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('offers GitHub and Notion under Connect, linking to Integrations', async () => {
    await renderPage()
    expect(screen.getByRole('link', { name: 'GitHub repository' }).getAttribute('href')).toBe('/integrations?tab=github')
    expect(screen.getByRole('link', { name: 'Notion workspace' }).getAttribute('href')).toBe('/integrations?tab=notion')
  })

  it('puts Sync now on the GitHub repository row, not on other sources', async () => {
    await renderPage()
    const rows = screen.getAllByRole('listitem')
    const githubRow = rows.find((r) => within(r).queryByText('acme/docs'))!
    const urlRow = rows.find((r) => within(r).queryByText('https://acme.test/about'))!
    expect(within(githubRow).getByRole('button', { name: 'Sync now' })).toBeTruthy()
    expect(within(urlRow).queryByRole('button', { name: 'Sync now' })).toBeNull()
  })

  it('syncs the repository from its row', async () => {
    h.runKbSync.mockResolvedValue({ ok: true, detail: '3 files updated' })
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(h.runKbSync).toHaveBeenCalledWith(
      '/api/github/sync-kb?repo_id=5',
      '/api/kb/sync-jobs?kind=github_repo&repo_id=5',
      expect.any(Function),
      expect.any(Function),
    )
    expect(await screen.findByText('acme/docs: 3 files updated')).toBeTruthy()
  })

  it('filters the list by type', async () => {
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'URLs' }))
    expect(screen.queryByText('acme/docs')).toBeNull()
    expect(screen.getByText('https://acme.test/about')).toBeTruthy()
  })
})
