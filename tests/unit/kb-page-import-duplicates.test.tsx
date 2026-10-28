// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The KB page's file upload and URL import results when some imported content
 * was already in the knowledge base (exact duplicates). The result line says
 * how many sections were left out, an import that only found duplicates is not
 * styled as a failure, and the upload route's 409 is shown as the error.
 */

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  ingestUrlAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('@/app/(dashboard)/kb/review-tab', () => ({ ReviewTab: () => <div /> }))
vi.mock('@/app/(dashboard)/kb/coverage-tab', () => ({ CoverageTab: () => <div /> }))
vi.mock('@/components/dashboard/notion-kb-section', () => ({ NotionKBSection: () => <div /> }))
vi.mock('@/components/dashboard/add-knowledge-section', () => ({ AddKnowledgeSection: () => <div /> }))
vi.mock('@/lib/actions/kb', () => ({ getTicketDraftAction: vi.fn() }))
vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: h.ingestUrlAction }))
vi.mock('@/lib/kb/sync-client', () => ({ runKbSync: vi.fn() }))

vi.stubGlobal('fetch', h.fetchMock)

function json(body: unknown, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response)
}

/** Every page load request returns an empty list; the upload route returns `upload`. */
function route(upload: () => Promise<Response>) {
  h.fetchMock.mockImplementation((url: string) => {
    if (url === '/api/kb/upload') return upload()
    if (url === '/api/kb/review?limit=0') return json({ counts: { pending: 0 } })
    if (url === '/api/kb' || url === '/api/kb/sources') return json([])
    return json({})
  })
}

async function renderPage() {
  const { default: KBPage } = await import('@/app/(dashboard)/kb/page')
  render(<KBPage />)
  await waitFor(() => expect(h.fetchMock).toHaveBeenCalledWith('/api/kb/review?limit=0'))
  await act(async () => {})
}

async function uploadFile(name = 'guide.md') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['# Guide'], name, { type: 'text/markdown' })
  await userEvent.setup({ applyAccept: false }).upload(input, file)
}

async function importUrl() {
  await userEvent.setup().type(screen.getByPlaceholderText('https://docs.example.com'), 'https://docs.example.com')
  fireEvent.submit(screen.getByRole('button', { name: 'Import' }).closest('form')!)
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('file upload result', () => {
  it('says how many sections were skipped, plural', async () => {
    route(() => json({ created: 4, duplicates: 3, filename: 'guide.md' }))
    await renderPage()
    await uploadFile()
    const line = await screen.findByText(/Ingested 4 chunks from guide\.md\./)
    expect(line.textContent).toContain('3 sections were already in your knowledge base, so they were not added again.')
    expect(line.className).toContain('text-green-600')
  })

  it('says it in the singular for one skipped section', async () => {
    route(() => json({ created: 2, duplicates: 1, filename: 'guide.md' }))
    await renderPage()
    await uploadFile()
    const line = await screen.findByText(/Ingested 2 chunks/)
    expect(line.textContent).toContain('1 section was already in your knowledge base, so it was not added again.')
  })

  it.each([[0], [undefined]])('says nothing about skipped sections when duplicates is %s', async (duplicates) => {
    route(() => json({ created: 2, duplicates, filename: 'guide.md' }))
    await renderPage()
    await uploadFile()
    const line = await screen.findByText(/Ingested 2 chunks from guide\.md\./)
    expect(line.textContent).not.toMatch(/already in your knowledge base/)
  })

  it('shows the upload route 409 as the error, in red, with no success line', async () => {
    const error = 'Everything in guide.md is already in your knowledge base, so nothing was added.'
    route(() => json({ error, duplicates: 5 }, false, 409))
    await renderPage()
    await uploadFile()
    const line = await screen.findByText(error)
    expect(line.className).toContain('text-red-500')
    expect(screen.queryByText(/Ingested/)).toBeNull()
    expect(screen.queryByText(/No chunks extracted/)).toBeNull()
  })
})

describe('URL import result', () => {
  it('appends the skipped-sections note to a single-page import', async () => {
    h.ingestUrlAction.mockResolvedValue({ created: 2, duplicates: 1 })
    route(() => json({}))
    await renderPage()
    await importUrl()
    const line = await screen.findByText(/Imported 2 articles/)
    expect(line.textContent).toContain('1 section was already in your knowledge base, so it was not added again.')
    expect(line.className).toContain('text-green-600')
  })

  it('appends the plural note to a site import', async () => {
    h.ingestUrlAction.mockResolvedValue({ created: 5, pages: 6, duplicates: 4 })
    route(() => json({}))
    await renderPage()
    await importUrl()
    const line = await screen.findByText(/Imported 5 articles from 6 pages/)
    expect(line.textContent).toContain('4 sections were already in your knowledge base, so they were not added again.')
  })

  it('does not style an import as a failure when nothing was created only because everything was a duplicate', async () => {
    h.ingestUrlAction.mockResolvedValue({ created: 0, duplicates: 2 })
    route(() => json({}))
    await renderPage()
    await importUrl()
    const line = await screen.findByText(/Imported 0 articles/)
    expect(line.className).not.toContain('text-red-600')
    expect(line.className).toContain('text-green-600')
    expect(line.textContent).toContain('2 sections were already in your knowledge base')
  })

  it('shows an interrupted duplicate-only import as amber, not red', async () => {
    h.ingestUrlAction.mockResolvedValue({ created: 0, duplicates: 2, incomplete: true })
    route(() => json({}))
    await renderPage()
    await importUrl()
    const line = await screen.findByText(/Imported 0 articles/)
    expect(line.className).toContain('text-amber-600')
  })

  it('still styles an import that created nothing and skipped no duplicates as a failure', async () => {
    h.ingestUrlAction.mockResolvedValue({ created: 0 })
    route(() => json({}))
    await renderPage()
    await importUrl()
    const line = await screen.findByText(/Imported 0 articles/)
    expect(line.className).toContain('text-red-600')
    expect(line.textContent).not.toMatch(/already in your knowledge base/)
  })
})
