// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { KBArticleAnswerView } from '@/types'

/**
 * The recent answers shown under an article: closed until asked for, loaded the
 * first time it is opened, then where each answer was given, when, the outcome
 * and whether the article has changed since. A member who is refused gets a
 * plain message, an empty window says so, and a failed load can be retried.
 */

const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

const view = (over: Partial<KBArticleAnswerView> & Pick<KBArticleAnswerView, 'answer_id'>): KBArticleAnswerView => ({
  surface: 'widget',
  outcome: 'generated',
  created_at: '2026-10-25T10:00:00.000Z',
  rank: 1,
  score: null,
  article_content_hash: 'h',
  revision: 'current',
  ...over,
})

const ok = (answers: KBArticleAnswerView[]) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ answers }) } as Response)
const failWith = (status: number) => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response)

async function renderAnswers(articleId = 9) {
  const { ArticleAnswers } = await import('@/components/dashboard/article-answers')
  return render(<ArticleAnswers articleId={articleId} />)
}
const toggle = () => screen.getByRole('button', { name: /show recent answers|hide recent answers/i })

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation(() => ok([]))
})

describe('ArticleAnswers loading', () => {
  it('stays closed and fetches nothing until it is opened', async () => {
    await renderAnswers()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('loads this article\'s answers the first time it is opened, with a loading state', async () => {
    let release!: (r: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
    await renderAnswers(42)
    await userEvent.click(toggle())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/kb/articles/42/answers')
    expect(screen.getByRole('status').textContent).toMatch(/loading answers/i)
    release({ ok: true, status: 200, json: () => Promise.resolve({ answers: [] }) } as Response)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('does not fetch again when it is closed and reopened', async () => {
    await renderAnswers()
    await userEvent.click(toggle())
    await screen.findByText(/not supplied to any answer/i)
    await userEvent.click(toggle())
    await userEvent.click(toggle())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('ArticleAnswers content', () => {
  it('says so, with the retention window, when the article was not supplied to any answer', async () => {
    await renderAnswers()
    await userEvent.click(toggle())
    expect(await screen.findByText('Not supplied to any answer in the last 90 days.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('lists each answer with where it was given, when, the outcome and its position', async () => {
    fetchMock.mockImplementation(() =>
      ok([
        view({ answer_id: 'a1', surface: 'widget', outcome: 'generated', rank: 1 }),
        view({ answer_id: 'a2', surface: 'discord', outcome: 'failed', rank: 3, created_at: '2026-10-24T10:00:00.000Z' }),
        view({ answer_id: 'a3', surface: 'ticket', rank: 2 }),
        view({ answer_id: 'a4', surface: 'agent_api', rank: 1 }),
      ])
    )
    await renderAnswers()
    await userEvent.click(toggle())
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Website chat widget')
    expect(rows[0].textContent).toContain('Answer generated')
    expect(rows[0].textContent).toContain('Position 1')
    expect(rows[1].textContent).toContain('Discord /ask')
    expect(rows[1].textContent).toContain('Generation failed')
    expect(rows[1].textContent).toContain('Position 3')
    expect(rows[2].textContent).toContain('Support ticket draft')
    expect(rows[3].textContent).toContain('Agent API')
  })

  it('marks an answer given when the article was different, and not one given on its current version', async () => {
    fetchMock.mockImplementation(() =>
      ok([view({ answer_id: 'a1', revision: 'earlier' }), view({ answer_id: 'a2', revision: 'current' })])
    )
    await renderAnswers()
    await userEvent.click(toggle())
    const [earlier, current] = await screen.findAllByRole('listitem')
    expect(earlier.textContent).toContain('The article has changed since this answer.')
    expect(current.textContent).not.toContain('has changed since')
  })

  it('shows a time element for each answer', async () => {
    fetchMock.mockImplementation(() => ok([view({ answer_id: 'a1' })]))
    await renderAnswers()
    await userEvent.click(toggle())
    const time = (await screen.findByRole('listitem')).querySelector('time')
    expect(time?.getAttribute('datetime')).toBe('2026-10-25T10:00:00.000Z')
  })

  it('says supplied as context, and never that the reply used or cited the article', async () => {
    fetchMock.mockImplementation(() => ok([view({ answer_id: 'a1' })]))
    await renderAnswers()
    await userEvent.click(toggle())
    await screen.findByRole('listitem')
    const text = document.body.textContent ?? ''
    expect(text).toContain('supplied to as context')
    expect(text).toContain('The assistant decides what to use')
    // the copy may deny it ("does not mean the reply quoted it"); it must never claim it
    expect(text).not.toMatch(/\b(was cited|cited by|cited in|was used by|used in the reply|was quoted)\b/i)
  })
})

describe('ArticleAnswers failure', () => {
  it.each([401, 403])('tells a person who is not allowed that only owners and admins can see it (%s)', async (status) => {
    fetchMock.mockImplementationOnce(() => failWith(status))
    await renderAnswers()
    await userEvent.click(toggle())
    expect((await screen.findByRole('alert')).textContent).toMatch(/only owners and admins/i)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('says it could not load, and a retry loads it', async () => {
    fetchMock.mockImplementationOnce(() => failWith(500))
    await renderAnswers()
    await userEvent.click(toggle())
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load the answers/i)
    fetchMock.mockImplementationOnce(() => ok([view({ answer_id: 'a1' })]))
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('listitem')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a network failure the same way', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    await renderAnswers()
    await userEvent.click(toggle())
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load/i)
  })
})
