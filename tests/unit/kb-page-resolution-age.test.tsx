// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The Manage tab's saved-resolution age: resolutions show when they were last
 * saved, the list can be sorted by that date or narrowed to resolutions, and
 * both controls step aside while a search is in play. The other sections of
 * the page are stubbed. Only Date is faked so user events still run.
 */

const NOW = new Date('2026-11-05T12:00:00.000Z')

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  articles: { current: [] as unknown[] },
  results: { current: [] as unknown[] },
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('@/app/(dashboard)/kb/review-tab', () => ({ ReviewTab: () => <div /> }))
vi.mock('@/app/(dashboard)/kb/coverage-tab', () => ({ CoverageTab: () => <div /> }))
vi.mock('@/components/dashboard/notion-kb-section', () => ({ NotionKBSection: () => <div /> }))
vi.mock('@/components/dashboard/add-knowledge-section', () => ({ AddKnowledgeSection: () => <div /> }))
vi.mock('@/lib/actions/kb', () => ({
  getTicketDraftAction: vi.fn(),
  verifyArticleAction: vi.fn(),
}))
vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: vi.fn() }))
vi.mock('@/lib/kb/sync-client', () => ({ runKbSync: vi.fn() }))

vi.stubGlobal('fetch', h.fetchMock)

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)

const article = (id: number, question: string, updated_at: string, extra: Record<string, unknown> = {}) => ({
  id,
  question,
  answer: `Answer to ${question}`,
  source_ticket_id: null,
  source_ticket_number: null,
  source_id: null,
  source_page: null,
  published: 1,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at,
  ...extra,
})
const resolution = (id: number, question: string, updated_at: string) =>
  article(id, question, updated_at, { source_ticket_id: id * 10, source_ticket_number: id * 100 })
const fromFile = (id: number, question: string, updated_at: string) =>
  article(id, question, updated_at, { source_id: 5 })

async function renderPage() {
  const { default: KBPage } = await import('@/app/(dashboard)/kb/page')
  const view = render(<KBPage />)
  await act(async () => {})
  return view
}

const headings = () => Array.from(document.querySelectorAll('ul > li h2')).map((h2) => h2.textContent)
const card = (question: string) => screen.getByRole('heading', { name: question }).closest('li') as HTMLElement
const sortSelect = () => screen.getByRole('combobox', { name: /sort/i }) as HTMLSelectElement
const onlyBox = () => screen.getByRole('checkbox', { name: /saved resolutions only/i }) as HTMLInputElement
const searchBox = () => screen.getByPlaceholderText('Search the knowledge base…')

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  h.articles.current = []
  h.results.current = []
  h.fetchMock.mockImplementation((url: string) => {
    if (url === '/api/kb') return json(h.articles.current)
    if (url === '/api/kb/sources') return json([])
    if (url.startsWith('/api/kb/search')) return json({ results: h.results.current })
    return json({})
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('KB manage tab saved-resolution age', () => {
  it('shows "Saved <date> · <age>" with a time element on a resolution', async () => {
    const updated = '2026-08-05T12:00:00.000Z'
    h.articles.current = [resolution(1, 'Reset password', updated)]
    await renderPage()
    await screen.findByRole('heading', { name: 'Reset password' })

    const line = within(card('Reset password')).getByText(/^Saved /)
    expect(line.textContent).toBe(`Saved ${new Date(updated).toLocaleDateString()} · 3 months ago`)
    const time = line.querySelector('time')!
    expect(time.getAttribute('datetime')).toBe(updated)
    expect(time.textContent).toBe(new Date(updated).toLocaleDateString())
  })

  it('shows a today age for something saved earlier the same day', async () => {
    h.articles.current = [resolution(1, 'Fresh one', '2026-11-05T08:00:00.000Z')]
    await renderPage()
    await screen.findByRole('heading', { name: 'Fresh one' })
    expect(within(card('Fresh one')).getByText(/· today$/)).toBeTruthy()
  })

  it('shows no Saved line on articles that did not come from a ticket', async () => {
    h.articles.current = [
      fromFile(1, 'From a file', '2026-10-01T00:00:00.000Z'),
      article(2, 'Typed by hand', '2026-10-02T00:00:00.000Z'),
      resolution(3, 'From a ticket', '2026-10-03T00:00:00.000Z'),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'From a file' })
    expect(within(card('From a file')).queryByText(/^Saved /)).toBeNull()
    expect(within(card('Typed by hand')).queryByText(/^Saved /)).toBeNull()
    expect(within(card('From a ticket')).getByText(/^Saved /)).toBeTruthy()
  })

  it('omits the Saved line when the resolution date is unreadable', async () => {
    h.articles.current = [resolution(1, 'Broken date', 'not a date')]
    await renderPage()
    await screen.findByRole('heading', { name: 'Broken date' })
    expect(within(card('Broken date')).queryByText(/^Saved /)).toBeNull()
  })

  it('defaults to newest saved first', async () => {
    h.articles.current = [
      article(1, 'Oldest', '2026-01-01T00:00:00.000Z'),
      article(2, 'Newest', '2026-10-01T00:00:00.000Z'),
      article(3, 'Middle', '2026-05-01T00:00:00.000Z'),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'Oldest' })
    expect(sortSelect().value).toBe('newest')
    expect(headings()).toEqual(['Newest', 'Middle', 'Oldest'])
  })

  it('reverses the list when Oldest saved first is chosen, and back again', async () => {
    const user = userEvent.setup()
    h.articles.current = [
      article(1, 'Oldest', '2026-01-01T00:00:00.000Z'),
      article(2, 'Newest', '2026-10-01T00:00:00.000Z'),
      article(3, 'Middle', '2026-05-01T00:00:00.000Z'),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'Oldest' })

    await user.selectOptions(sortSelect(), 'Oldest saved first')
    expect(headings()).toEqual(['Oldest', 'Middle', 'Newest'])

    await user.selectOptions(sortSelect(), 'Newest saved first')
    expect(headings()).toEqual(['Newest', 'Middle', 'Oldest'])
  })

  it('moves a refreshed resolution (later updated_at) to the top of newest order', async () => {
    h.articles.current = [
      resolution(1, 'Refreshed', '2026-02-01T00:00:00.000Z'),
      resolution(2, 'Untouched', '2026-06-01T00:00:00.000Z'),
    ]
    const { unmount } = await renderPage()
    await screen.findByRole('heading', { name: 'Untouched' })
    expect(headings()).toEqual(['Untouched', 'Refreshed'])
    unmount()

    h.articles.current = [
      resolution(1, 'Refreshed', '2026-11-04T00:00:00.000Z'),
      resolution(2, 'Untouched', '2026-06-01T00:00:00.000Z'),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'Untouched' })
    expect(headings()).toEqual(['Refreshed', 'Untouched'])
    expect(within(card('Refreshed')).getByText(/· yesterday$/)).toBeTruthy()
  })

  it('hides non-resolutions when Saved resolutions only is ticked, and restores them when cleared', async () => {
    const user = userEvent.setup()
    h.articles.current = [
      fromFile(1, 'From a file', '2026-10-01T00:00:00.000Z'),
      resolution(2, 'Ticket answer', '2026-09-01T00:00:00.000Z'),
      article(3, 'Typed by hand', '2026-10-05T00:00:00.000Z'),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'From a file' })
    expect(onlyBox().checked).toBe(false)

    await user.click(onlyBox())
    expect(headings()).toEqual(['Ticket answer'])

    await user.click(onlyBox())
    expect(headings()).toEqual(['Typed by hand', 'From a file', 'Ticket answer'])
  })

  it('combines the filter with the sort order', async () => {
    const user = userEvent.setup()
    h.articles.current = [
      resolution(1, 'Recent ticket', '2026-10-01T00:00:00.000Z'),
      fromFile(2, 'A file', '2026-10-10T00:00:00.000Z'),
      resolution(3, 'Old ticket', '2026-02-01T00:00:00.000Z'),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'A file' })
    await user.click(onlyBox())
    await user.selectOptions(sortSelect(), 'Oldest saved first')
    expect(headings()).toEqual(['Old ticket', 'Recent ticket'])
  })

  it('shows the empty message when the filter leaves no saved resolutions', async () => {
    const user = userEvent.setup()
    h.articles.current = [fromFile(1, 'From a file', '2026-10-01T00:00:00.000Z')]
    await renderPage()
    await screen.findByRole('heading', { name: 'From a file' })

    await user.click(onlyBox())
    expect(screen.getByText(/^No saved resolutions yet\./)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'From a file' })).toBeNull()
    // The controls stay so the filter can be turned off again.
    expect(onlyBox().checked).toBe(true)
  })

  it('shows the no-articles message, not the controls, when the knowledge base is empty', async () => {
    await renderPage()
    expect(await screen.findByText(/^No articles yet\./)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /sort/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /saved resolutions only/i })).toBeNull()
  })

  it('hides the controls as soon as a search is typed and brings them back on clear', async () => {
    const user = userEvent.setup()
    h.articles.current = [article(1, 'Something', '2026-10-01T00:00:00.000Z')]
    await renderPage()
    await screen.findByRole('heading', { name: 'Something' })
    expect(sortSelect()).toBeTruthy()

    await user.type(searchBox(), 'pass')
    expect(screen.queryByRole('combobox', { name: /sort/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /saved resolutions only/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(sortSelect()).toBeTruthy()
    expect(onlyBox()).toBeTruthy()
  })

  it('keeps search results in the returned score order, ignoring the sort and filter', async () => {
    const user = userEvent.setup()
    h.articles.current = [
      fromFile(9, 'Listed file', '2026-10-01T00:00:00.000Z'),
      resolution(8, 'Listed ticket', '2026-10-02T00:00:00.000Z'),
    ]
    // Best match is the oldest, and the second hit is not a resolution.
    h.results.current = [
      resolution(1, 'Best match, oldest', '2026-01-01T00:00:00.000Z'),
      fromFile(2, 'Second match, newest', '2026-10-30T00:00:00.000Z'),
      resolution(3, 'Third match, middle', '2026-06-01T00:00:00.000Z'),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'Listed file' })
    // Pick the non-default settings first; they must not leak into search.
    await user.click(onlyBox())
    await user.selectOptions(sortSelect(), 'Oldest saved first')

    await user.type(searchBox(), 'match{Enter}')
    await screen.findByRole('heading', { name: 'Best match, oldest' })

    expect(headings()).toEqual(['Best match, oldest', 'Second match, newest', 'Third match, middle'])
    expect(screen.queryByRole('combobox', { name: /sort/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /saved resolutions only/i })).toBeNull()
  })
})
