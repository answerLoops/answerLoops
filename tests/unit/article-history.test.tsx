// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { KBArticleHistoryEntry } from '@/types'

/**
 * The history shown under each article: closed until asked for, loaded the
 * first time it is opened, then a newest-first list of what happened, who did
 * it, when and where it came from. Imports and syncs never look like people,
 * an article from before history was recorded says so, and a failed load can be
 * retried.
 */

const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

const entry = (over: Partial<KBArticleHistoryEntry> & Pick<KBArticleHistoryEntry, 'id' | 'type' | 'origin'>): KBArticleHistoryEntry => ({
  article_id: 9,
  actor_user_id: null,
  source_ticket_id: null,
  review_item_id: null,
  content_hash: 'h',
  created_at: '2026-10-20T10:00:00.000Z',
  actor_name: null,
  source_ticket_number: null,
  ...over,
})

const ok = (events: KBArticleHistoryEntry[]) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ events }) } as Response)
const fail = (status = 500) => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response)

async function renderHistory(articleId = 9) {
  const { ArticleHistory } = await import('@/components/dashboard/article-history')
  return render(<ArticleHistory articleId={articleId} />)
}
const toggle = () => screen.getByRole('button', { name: /show history|hide history/i })

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation(() => ok([]))
})

describe('ArticleHistory loading', () => {
  it('stays closed and fetches nothing until it is opened', async () => {
    await renderHistory()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('loads this article\'s history the first time it is opened, and shows a loading state', async () => {
    let release!: (r: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
    await renderHistory(42)
    await userEvent.click(toggle())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/kb/articles/42/history')
    expect(screen.getByRole('status').textContent).toMatch(/loading history/i)
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    release({ ok: true, status: 200, json: () => Promise.resolve({ events: [] }) } as Response)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('does not fetch again when it is closed and reopened', async () => {
    await renderHistory()
    await userEvent.click(toggle())
    await waitFor(() => expect(screen.getByText(/no history recorded/i)).toBeTruthy())
    await userEvent.click(toggle())
    expect(screen.queryByText(/no history recorded/i)).toBeNull()
    await userEvent.click(toggle())
    expect(screen.getByText(/no history recorded/i)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('ArticleHistory content', () => {
  it('says so when an article has no history, instead of showing an empty list', async () => {
    await renderHistory()
    await userEvent.click(toggle())
    expect(await screen.findByText('No history recorded before this was introduced.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('lists a mixed timeline in the order the server sent it, with who, when and where from', async () => {
    fetchMock.mockImplementation(() =>
      ok([
        entry({ id: 5, type: 'verified', origin: 'manual', actor_user_id: 12, actor_name: 'Dana', created_at: '2026-10-22T09:00:00.000Z' }),
        entry({ id: 4, type: 'edited', origin: 'sync', created_at: '2026-10-21T09:00:00.000Z' }),
        entry({ id: 3, type: 'promoted', origin: 'ticket_promotion', actor_user_id: 13, actor_name: 'Lee', source_ticket_id: 41, source_ticket_number: 38 }),
      ])
    )
    await renderHistory()
    await userEvent.click(toggle())
    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items.map((li) => within(li).getAllByText(/./)[0].textContent)).toEqual([
      'Verified',
      'Updated by a sync',
      'Promoted from a ticket',
    ])
    expect(items[0].textContent).toContain('Dana')
    expect(items[0].textContent).toContain('By hand')
    expect(items[2].textContent).toContain('Lee')
    expect(items[2].textContent).toContain('From a ticket')
  })

  it('shows a time element for each entry', async () => {
    fetchMock.mockImplementation(() => ok([entry({ id: 1, type: 'created', origin: 'manual', actor_name: 'Dana', actor_user_id: 1 })]))
    await renderHistory()
    await userEvent.click(toggle())
    const time = (await screen.findByRole('listitem')).querySelector('time')
    expect(time?.getAttribute('datetime')).toBe('2026-10-20T10:00:00.000Z')
  })

  it('links an event that came from a ticket to that ticket', async () => {
    fetchMock.mockImplementation(() =>
      ok([entry({ id: 1, type: 'promoted', origin: 'ticket_promotion', actor_user_id: 1, actor_name: 'Dana', source_ticket_id: 41, source_ticket_number: 38 })])
    )
    await renderHistory()
    await userEvent.click(toggle())
    const link = await screen.findByRole('link', { name: /ticket #38/i })
    expect(link.getAttribute('href')).toBe('/tickets/38')
  })

  it('shows no ticket link for an event that did not come from a ticket', async () => {
    fetchMock.mockImplementation(() => ok([entry({ id: 1, type: 'created', origin: 'manual', actor_user_id: 1, actor_name: 'Dana' })]))
    await renderHistory()
    await userEvent.click(toggle())
    await screen.findByRole('listitem')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows imports and syncs as what they are, never as a person', async () => {
    fetchMock.mockImplementation(() =>
      ok([
        entry({ id: 2, type: 'edited', origin: 'sync' }),
        entry({ id: 1, type: 'created', origin: 'import' }),
      ])
    )
    await renderHistory()
    await userEvent.click(toggle())
    const [sync, imported] = await screen.findAllByRole('listitem')
    expect(sync.textContent).toContain('Synced')
    expect(sync.textContent).not.toMatch(/former team member|unknown/i)
    expect(imported.textContent).toContain('Imported')
    expect(imported.textContent).not.toMatch(/former team member|unknown/i)
    // the actor already says where it came from, so the tag is not repeated
    expect(sync.textContent).not.toMatch(/Synced.*Sync$/)
    expect(imported.textContent).not.toMatch(/Imported.*Import$/)
  })

  it('says former team member when the person was removed', async () => {
    fetchMock.mockImplementation(() => ok([entry({ id: 1, type: 'review_approved', origin: 'review_queue', actor_user_id: null, actor_name: null })]))
    await renderHistory()
    await userEvent.click(toggle())
    expect((await screen.findByRole('listitem')).textContent).toContain('Former team member')
  })
})

describe('ArticleHistory failure', () => {
  it('says it could not load, and a retry loads it', async () => {
    fetchMock.mockImplementationOnce(() => fail(500))
    await renderHistory()
    await userEvent.click(toggle())
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load the history/i)
    fetchMock.mockImplementationOnce(() => ok([entry({ id: 1, type: 'created', origin: 'manual', actor_user_id: 1, actor_name: 'Dana' })]))
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('listitem')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a network failure the same way', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    await renderHistory()
    await userEvent.click(toggle())
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load/i)
  })
})
