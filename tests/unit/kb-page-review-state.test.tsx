// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The Sources tab's article list and review states: the Show filter narrows the
 * list to articles that need review or were superseded, its counts come from the
 * whole list, the empty message matches the filter, and the replacement picker
 * for an article offers every article that is not superseded and not itself.
 * The other sections of the page are stubbed.
 */

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  supersedeArticleAction: vi.fn(),
  articles: { current: [] as unknown[] },
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
  flagArticleForReviewAction: vi.fn(),
  clearReviewFlagAction: vi.fn(),
  supersedeArticleAction: h.supersedeArticleAction,
  restoreArticleAction: vi.fn(),
}))
vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: vi.fn() }))
vi.mock('@/lib/kb/sync-client', () => ({ runKbSync: vi.fn() }))

vi.stubGlobal('fetch', h.fetchMock)

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)

type State = 'current' | 'needs_review' | 'superseded'

const article = (id: number, question: string, state: State, canSupersede = true) => ({
  id,
  question,
  answer: `Answer to ${question}`,
  source_ticket_id: null,
  source_ticket_number: null,
  source_id: null,
  source_page: null,
  published: 1,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  can_supersede: canSupersede,
  review: {
    state,
    at: state === 'current' ? null : '2026-10-02T00:00:00.000Z',
    by_name: null,
    note: null,
    replacement: state === 'superseded' ? { kind: 'url', url: 'https://docs.example.com/new' } : null,
  },
})

async function renderPage() {
  const { default: KBPage } = await import('@/app/(dashboard)/kb/page')
  const view = render(<KBPage />)
  await act(async () => {})
  return view
}

const heading = (question: string) => screen.queryByRole('heading', { name: question })
const card = (question: string) => screen.getByRole('heading', { name: question }).closest('li') as HTMLElement
const showSelect = () => screen.getByRole('combobox', { name: /^show/i }) as HTMLSelectElement
const optionLabels = (select: HTMLSelectElement) => Array.from(select.options).map((o) => o.textContent)

const MIXED = () => [
  article(1, 'Still current', 'current'),
  article(2, 'Flagged one', 'needs_review'),
  article(3, 'Flagged two', 'needs_review'),
  article(4, 'Replaced one', 'superseded'),
]

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  h.supersedeArticleAction.mockResolvedValue({ ok: true })
  h.articles.current = []
  h.fetchMock.mockImplementation((url: string) => json(url === '/api/kb' ? h.articles.current : url === '/api/kb/sources' ? [] : {}))
})

describe('KB manage tab review filter', () => {
  it('counts needs-review and superseded articles across the full list', async () => {
    h.articles.current = MIXED()
    await renderPage()
    await screen.findByRole('heading', { name: 'Still current' })
    expect(optionLabels(showSelect())).toEqual(['All articles', 'Needs review (2)', 'Superseded (1)'])
  })

  it('shows every article by default, and narrows to one review state when chosen', async () => {
    const user = userEvent.setup()
    h.articles.current = MIXED()
    await renderPage()
    await screen.findByRole('heading', { name: 'Still current' })
    for (const q of ['Still current', 'Flagged one', 'Flagged two', 'Replaced one']) expect(heading(q)).toBeTruthy()

    await user.selectOptions(showSelect(), 'needs_review')
    expect(heading('Flagged one')).toBeTruthy()
    expect(heading('Flagged two')).toBeTruthy()
    expect(heading('Still current')).toBeNull()
    expect(heading('Replaced one')).toBeNull()
    // The counts still describe the whole list, not the filtered view.
    expect(optionLabels(showSelect())).toEqual(['All articles', 'Needs review (2)', 'Superseded (1)'])

    await user.selectOptions(showSelect(), 'superseded')
    expect(heading('Replaced one')).toBeTruthy()
    expect(heading('Flagged one')).toBeNull()
    expect(heading('Still current')).toBeNull()

    await user.selectOptions(showSelect(), 'all')
    expect(heading('Still current')).toBeTruthy()
    expect(heading('Replaced one')).toBeTruthy()
  })

  it('says no articles need review when the filter matches nothing', async () => {
    const user = userEvent.setup()
    h.articles.current = [article(1, 'Still current', 'current')]
    await renderPage()
    await screen.findByRole('heading', { name: 'Still current' })
    await user.selectOptions(showSelect(), 'needs_review')
    expect(screen.getByText('No articles need review.')).toBeTruthy()
    expect(heading('Still current')).toBeNull()
  })

  it('says no articles have been superseded when that filter matches nothing', async () => {
    const user = userEvent.setup()
    h.articles.current = [article(1, 'Flagged one', 'needs_review')]
    await renderPage()
    await screen.findByRole('heading', { name: 'Flagged one' })
    await user.selectOptions(showSelect(), 'superseded')
    expect(screen.getByText('No articles have been superseded.')).toBeTruthy()
    expect(screen.queryByText('No articles need review.')).toBeNull()
  })
})

describe('KB manage tab review controls', () => {
  it('gives each article its own review control for its state', async () => {
    h.articles.current = MIXED()
    await renderPage()
    await screen.findByRole('heading', { name: 'Still current' })
    expect(within(card('Still current')).getByRole('button', { name: /^flag for review$/i })).toBeTruthy()
    expect(within(card('Flagged one')).getByRole('button', { name: /^clear review flag$/i })).toBeTruthy()
    expect(within(card('Replaced one')).getByRole('button', { name: /^restore to answers$/i })).toBeTruthy()
  })

  it('shows supersede and restore only when /api/kb says the viewer can supersede', async () => {
    h.articles.current = [article(1, 'Still current', 'current', false), article(2, 'Replaced one', 'superseded', false)]
    await renderPage()
    await screen.findByRole('heading', { name: 'Still current' })
    expect(within(card('Still current')).getByRole('button', { name: /^flag for review$/i })).toBeTruthy()
    expect(within(card('Still current')).queryByRole('button', { name: /mark as superseded/i })).toBeNull()
    expect(within(card('Replaced one')).queryByRole('button', { name: /restore to answers/i })).toBeNull()
  })

  it('shows no review control on an article that carries no review state', async () => {
    const { review: _omit, ...bare } = article(1, 'A search hit', 'current')
    h.articles.current = [bare]
    await renderPage()
    await screen.findByRole('heading', { name: 'A search hit' })
    expect(within(card('A search hit')).queryByRole('button', { name: /flag for review/i })).toBeNull()
  })

  it('offers every non-superseded article except itself as a replacement, even while filtered', async () => {
    const user = userEvent.setup()
    h.articles.current = MIXED()
    await renderPage()
    await screen.findByRole('heading', { name: 'Flagged one' })
    // Filter first: the picker must still see articles hidden by the filter.
    await user.selectOptions(showSelect(), 'needs_review')
    const c = card('Flagged one')
    await user.click(within(c).getByRole('button', { name: /^mark as superseded$/i }))
    const picker = within(c).getByLabelText(/replacement article/i) as HTMLSelectElement
    const offered = Array.from(picker.options)
      .filter((o) => o.value)
      .map((o) => o.textContent)
    expect(offered.sort()).toEqual(['Flagged two', 'Still current'])
  })

  it('reloads the article list after an article is superseded', async () => {
    const user = userEvent.setup()
    h.articles.current = MIXED()
    await renderPage()
    await screen.findByRole('heading', { name: 'Still current' })
    const loads = () => h.fetchMock.mock.calls.filter(([url]) => url === '/api/kb').length
    const before = loads()
    const c = card('Still current')
    await user.click(within(c).getByRole('button', { name: /^mark as superseded$/i }))
    await user.selectOptions(within(c).getByLabelText(/replacement article/i), '2')
    await user.click(within(c).getAllByRole('button', { name: /^mark as superseded$/i }).at(-1)!)
    await waitFor(() => expect(h.supersedeArticleAction).toHaveBeenCalledOnce())
    const fd = h.supersedeArticleAction.mock.calls[0][1] as FormData
    expect(fd.get('articleId')).toBe('1')
    expect(fd.get('replacementArticleId')).toBe('2')
    await waitFor(() => expect(loads()).toBe(before + 1))
  })
})
