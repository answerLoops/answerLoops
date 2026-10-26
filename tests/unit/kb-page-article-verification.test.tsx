// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The Manage tab's article list: each article shows whether a person has checked
 * it, and the control to do so reloads the list when it succeeds. The other
 * sections of the page are stubbed.
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

const article = (id: number, question: string, verification?: Record<string, unknown>) => ({
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
  ...(verification ? { verification } : {}),
})

const NEVER = { status: 'never', verified_at: null, verified_by: null, verified_by_name: null, note: null }
const VERIFIED = { status: 'verified', verified_at: '2026-10-01T12:00:00.000Z', verified_by: 12, verified_by_name: 'Dana', note: null }
const CHANGED = { ...VERIFIED, status: 'changed' }

async function renderPage() {
  const { default: KBPage } = await import('@/app/(dashboard)/kb/page')
  const view = render(<KBPage />)
  await act(async () => {})
  return view
}

const card = (question: string) => screen.getByRole('heading', { name: question }).closest('li') as HTMLElement
const articleLoads = () => h.fetchMock.mock.calls.filter(([url]) => url === '/api/kb').length

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  h.verifyArticleAction.mockResolvedValue({ ok: true })
  h.articles.current = []
  h.fetchMock.mockImplementation((url: string) => json(url === '/api/kb' ? h.articles.current : url === '/api/kb/sources' ? [] : {}))
})

describe('KB manage tab article verification', () => {
  it('shows each article as never verified, verified or changed since last verified', async () => {
    h.articles.current = [
      article(1, 'Never checked', NEVER),
      article(2, 'Checked and current', VERIFIED),
      article(3, 'Edited since the check', CHANGED),
    ]
    await renderPage()
    expect(await screen.findByRole('heading', { name: 'Never checked' })).toBeTruthy()
    expect(within(card('Never checked')).getByText('Never verified')).toBeTruthy()
    expect(within(card('Checked and current')).getByText(/^Verified .* by Dana$/)).toBeTruthy()
    expect(within(card('Edited since the check')).getByText(/^Changed since last verified/)).toBeTruthy()
  })

  it('gives each article its own control, labelled for that article', async () => {
    h.articles.current = [article(1, 'First', NEVER), article(2, 'Second', VERIFIED)]
    await renderPage()
    await screen.findByRole('heading', { name: 'First' })
    expect(within(card('First')).getByRole('button', { name: /^mark as verified$/i })).toBeTruthy()
    expect(within(card('Second')).getByRole('button', { name: /^verify again$/i })).toBeTruthy()
  })

  it('shows no verification control on an article that carries no verification (a search result)', async () => {
    h.articles.current = [article(1, 'A search hit')]
    await renderPage()
    await screen.findByRole('heading', { name: 'A search hit' })
    expect(within(card('A search hit')).queryByText(/verified/i)).toBeNull()
    expect(within(card('A search hit')).queryByRole('button', { name: /verif/i })).toBeNull()
  })

  it('reloads the article list after an article is verified', async () => {
    const user = userEvent.setup()
    h.articles.current = [article(1, 'Never checked', NEVER)]
    await renderPage()
    await screen.findByRole('heading', { name: 'Never checked' })
    const before = articleLoads()

    await user.click(within(card('Never checked')).getByRole('button', { name: /^mark as verified$/i }))
    await user.click(within(card('Never checked')).getAllByRole('button', { name: /^mark as verified$/i }).at(-1)!)

    await waitFor(() => expect(h.verifyArticleAction).toHaveBeenCalledOnce())
    expect((h.verifyArticleAction.mock.calls[0][1] as FormData).get('articleId')).toBe('1')
    await waitFor(() => expect(articleLoads()).toBe(before + 1))
  })
})
