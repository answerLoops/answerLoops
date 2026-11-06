// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The Manage tab's "related docs changed" notice: a saved resolution whose
 * related documentation changed after it was saved says so under its Saved
 * line, and the notice goes away once the list reloads without the flag (after
 * the answer is verified again). The other sections of the page are stubbed.
 */

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  verifyArticleAction: vi.fn(),
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
  verifyArticleAction: h.verifyArticleAction,
}))
vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: vi.fn() }))
vi.mock('@/lib/kb/sync-client', () => ({ runKbSync: vi.fn() }))

vi.stubGlobal('fetch', h.fetchMock)

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)

const VERIFIED = { status: 'verified', verified_at: '2026-10-01T12:00:00.000Z', verified_by: 12, verified_by_name: 'Dana', note: null }
const CHANGE_AT = '2026-10-20T09:30:00.000Z'
const CHANGE = { at: CHANGE_AT, source: 'acme/docs' }

const resolution = (id: number, question: string, extra: Record<string, unknown> = {}) => ({
  id,
  question,
  answer: `Answer to ${question}`,
  source_ticket_id: id * 10,
  source_ticket_number: id * 100,
  source_id: null,
  source_page: null,
  published: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  verification: VERIFIED,
  ...extra,
})

async function renderPage() {
  const { default: KBPage } = await import('@/app/(dashboard)/kb/page')
  const view = render(<KBPage />)
  await act(async () => {})
  return view
}

const card = (question: string) => screen.getByRole('heading', { name: question }).closest('li') as HTMLElement
const notice = (scope: HTMLElement) => within(scope).queryByText(/^Docs related to this answer changed after it was saved/)
const headings = () => Array.from(document.querySelectorAll('ul > li h2')).map((h2) => h2.textContent)

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  h.verifyArticleAction.mockResolvedValue({ ok: true })
  h.articles.current = []
  h.fetchMock.mockImplementation((url: string) => json(url === '/api/kb' ? h.articles.current : url === '/api/kb/sources' ? [] : {}))
})

describe('KB manage tab related-docs-changed notice', () => {
  it('shows the source, the formatted date and a time element on a flagged article', async () => {
    h.articles.current = [resolution(1, 'Reset password', { related_docs_changed: CHANGE })]
    await renderPage()
    await screen.findByRole('heading', { name: 'Reset password' })

    const p = notice(card('Reset password'))!
    expect(p).toBeTruthy()
    const date = new Date(CHANGE_AT).toLocaleDateString()
    expect(p.textContent).toBe(
      `Docs related to this answer changed after it was saved (acme/docs, ${date}). Check it still holds, then use Verify again to clear this.`,
    )
    const time = p.querySelector('time')!
    expect(time.getAttribute('datetime')).toBe(CHANGE_AT)
    expect(time.textContent).toBe(date)
  })

  it('is absent when related_docs_changed is null or missing', async () => {
    h.articles.current = [
      resolution(1, 'Null flag', { related_docs_changed: null }),
      resolution(2, 'No flag'),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'Null flag' })
    expect(notice(card('Null flag'))).toBeNull()
    expect(notice(card('No flag'))).toBeNull()
    expect(screen.queryByText(/Docs related to this answer/)).toBeNull()
  })

  it('is absent when the change date is unparseable', async () => {
    h.articles.current = [resolution(1, 'Broken date', { related_docs_changed: { at: 'not a date', source: 'acme/docs' } })]
    await renderPage()
    await screen.findByRole('heading', { name: 'Broken date' })
    expect(notice(card('Broken date'))).toBeNull()
    expect(card('Broken date').querySelector('time[datetime="not a date"]')).toBeNull()
  })

  it('shows on the flagged article only, not its neighbors', async () => {
    h.articles.current = [
      resolution(1, 'Above', { updated_at: '2026-10-03T00:00:00.000Z' }),
      resolution(2, 'Flagged', { updated_at: '2026-10-02T00:00:00.000Z', related_docs_changed: CHANGE }),
      resolution(3, 'Below', { updated_at: '2026-10-01T00:00:00.000Z' }),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'Flagged' })
    expect(notice(card('Flagged'))).toBeTruthy()
    expect(notice(card('Above'))).toBeNull()
    expect(notice(card('Below'))).toBeNull()
    expect(screen.getAllByText(/^Docs related to this answer changed/)).toHaveLength(1)
  })

  it('coexists with the Saved line and the verification control', async () => {
    h.articles.current = [resolution(1, 'All three', { related_docs_changed: CHANGE })]
    await renderPage()
    await screen.findByRole('heading', { name: 'All three' })
    const c = card('All three')
    const saved = within(c).getByText(/^Saved /)
    const n = notice(c)!
    const button = within(c).getByRole('button', { name: /^verify again$/i })
    expect(saved).toBeTruthy()
    expect(n).toBeTruthy()
    // Document order: Saved line, then the notice, then the verification control.
    expect(saved.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(n.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('disappears when the list reloads without the flag after the article is verified again', async () => {
    const user = userEvent.setup()
    h.articles.current = [resolution(1, 'Needs check', { related_docs_changed: CHANGE })]
    await renderPage()
    await screen.findByRole('heading', { name: 'Needs check' })
    expect(notice(card('Needs check'))).toBeTruthy()

    // The next load of the list comes back cleared, as it does after verifying.
    h.articles.current = [resolution(1, 'Needs check', { related_docs_changed: null })]
    await user.click(within(card('Needs check')).getByRole('button', { name: /^verify again$/i }))
    await user.click(within(card('Needs check')).getAllByRole('button', { name: /verif/i }).at(-1)!)

    await waitFor(() => expect(h.verifyArticleAction).toHaveBeenCalledOnce())
    await waitFor(() => expect(notice(card('Needs check'))).toBeNull())
    expect(within(card('Needs check')).getByText(/^Saved /)).toBeTruthy()
  })

  it('still renders when sorted oldest saved first', async () => {
    const user = userEvent.setup()
    h.articles.current = [
      resolution(1, 'Old flagged', { updated_at: '2026-01-01T00:00:00.000Z', related_docs_changed: CHANGE }),
      resolution(2, 'New plain', { updated_at: '2026-10-01T00:00:00.000Z' }),
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'Old flagged' })
    await user.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'Oldest saved first')
    expect(headings()).toEqual(['Old flagged', 'New plain'])
    expect(notice(card('Old flagged'))).toBeTruthy()
    expect(notice(card('New plain'))).toBeNull()
  })

  it('still renders when Saved resolutions only is ticked', async () => {
    const user = userEvent.setup()
    h.articles.current = [
      resolution(1, 'Flagged ticket', { related_docs_changed: CHANGE }),
      { ...resolution(2, 'From a file'), source_ticket_id: null, source_ticket_number: null, source_id: 5 },
    ]
    await renderPage()
    await screen.findByRole('heading', { name: 'From a file' })
    await user.click(screen.getByRole('checkbox', { name: /saved resolutions only/i }))
    expect(headings()).toEqual(['Flagged ticket'])
    expect(notice(card('Flagged ticket'))).toBeTruthy()
  })
})
