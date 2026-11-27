// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ArticleReview } from '@/types'
import { REVIEW_EFFECT } from '@/lib/kb/review-state'

/**
 * The review state of one article in the dashboard: which actions each state
 * and role offers, the confirmation step that says what each action does to
 * customer answers, what each action submits, and how a success, a failure and
 * a pending save behave. The server actions are faked.
 */

const h = vi.hoisted(() => ({
  flagArticleForReviewAction: vi.fn(),
  clearReviewFlagAction: vi.fn(),
  supersedeArticleAction: vi.fn(),
  restoreArticleAction: vi.fn(),
}))
vi.mock('@/lib/actions/kb', () => ({
  flagArticleForReviewAction: h.flagArticleForReviewAction,
  clearReviewFlagAction: h.clearReviewFlagAction,
  supersedeArticleAction: h.supersedeArticleAction,
  restoreArticleAction: h.restoreArticleAction,
}))

const CURRENT: ArticleReview = { state: 'current', at: null, by_name: null, note: null, replacement: null }
const NEEDS_REVIEW: ArticleReview = {
  state: 'needs_review',
  at: '2026-10-01T12:00:00.000Z',
  by_name: 'Dana',
  note: 'Pricing changed in October',
  replacement: null,
}
const SUPERSEDED_BY_ARTICLE: ArticleReview = {
  state: 'superseded',
  at: '2026-10-02T12:00:00.000Z',
  by_name: 'Dana',
  note: null,
  replacement: { kind: 'article', article_id: 42, question: 'How do I reset my password now?' },
}
const SUPERSEDED_BY_URL: ArticleReview = {
  ...SUPERSEDED_BY_ARTICLE,
  replacement: { kind: 'url', url: 'https://docs.example.com/reset' },
}
const SUPERSEDED_DELETED: ArticleReview = { ...SUPERSEDED_BY_ARTICLE, replacement: null }

const OPTIONS = [
  { id: 42, question: 'How do I reset my password now?' },
  { id: 43, question: 'Where is billing?' },
]

async function renderControl(
  review: ArticleReview,
  { canSupersede = true, options = OPTIONS, onChanged }: { canSupersede?: boolean; options?: typeof OPTIONS; onChanged?: () => void } = {}
) {
  const { ArticleReviewStateControl } = await import('@/components/dashboard/article-review-state')
  return render(
    <ArticleReviewStateControl
      articleId={9}
      review={review}
      canSupersede={canSupersede}
      replacementOptions={options}
      onChanged={onChanged}
    />
  )
}

const button = (name: RegExp) => screen.getByRole('button', { name })
const queryButton = (name: RegExp) => screen.queryByRole('button', { name })
/** The confirmation step's own submit button (the opener is hidden once a step is open). */
const submit = (name: RegExp) => screen.getAllByRole('button', { name }).at(-1)!
const noteBox = () => screen.getByLabelText(/reason \(optional\)/i) as HTMLTextAreaElement
const effectShown = (text: string) => screen.queryByText(text) !== null

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of Object.values(h)) fn.mockResolvedValue({ ok: true })
})

describe('ArticleReviewStateControl buttons per state and role', () => {
  it('current: offers Flag for review and, for an owner or admin, Mark as superseded', async () => {
    await renderControl(CURRENT)
    expect(button(/^flag for review$/i)).toBeTruthy()
    expect(button(/^mark as superseded$/i)).toBeTruthy()
    expect(queryButton(/clear review flag/i)).toBeNull()
    expect(queryButton(/restore to answers/i)).toBeNull()
  })

  it('needs review: offers Clear review flag (not Flag), shows the reason, and says it still answers', async () => {
    await renderControl(NEEDS_REVIEW)
    expect(button(/^clear review flag$/i)).toBeTruthy()
    expect(button(/^mark as superseded$/i)).toBeTruthy()
    expect(queryButton(/^flag for review$/i)).toBeNull()
    expect(screen.getByText('Pricing changed in October')).toBeTruthy()
    expect(screen.getByText(/needs review .*by Dana.*still used for answers/i)).toBeTruthy()
  })

  it('superseded: offers Restore to answers to an owner or admin, never Flag or Supersede', async () => {
    await renderControl(SUPERSEDED_BY_ARTICLE)
    expect(button(/^restore to answers$/i)).toBeTruthy()
    expect(queryButton(/flag for review/i)).toBeNull()
    expect(queryButton(/clear review flag/i)).toBeNull()
    expect(queryButton(/mark as superseded/i)).toBeNull()
    expect(screen.getByText(/superseded .*not used for answers/i)).toBeTruthy()
  })

  it('a member never sees supersede or restore, in any state', async () => {
    let view = await renderControl(CURRENT, { canSupersede: false })
    expect(button(/^flag for review$/i)).toBeTruthy()
    expect(queryButton(/mark as superseded/i)).toBeNull()
    view.unmount()

    view = await renderControl(NEEDS_REVIEW, { canSupersede: false })
    expect(button(/^clear review flag$/i)).toBeTruthy()
    expect(queryButton(/mark as superseded/i)).toBeNull()
    view.unmount()

    await renderControl(SUPERSEDED_BY_ARTICLE, { canSupersede: false })
    expect(queryButton(/restore to answers/i)).toBeNull()
    expect(queryButton(/flag for review/i)).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('ArticleReviewStateControl superseded replacement', () => {
  it('links to the replacing article in the list', async () => {
    await renderControl(SUPERSEDED_BY_ARTICLE)
    const link = screen.getByRole('link', { name: 'How do I reset my password now?' })
    expect(link.getAttribute('href')).toBe('#article-42')
    expect(link.getAttribute('target')).toBeNull()
  })

  it('opens a documentation link in a new tab without handing over the opener', async () => {
    await renderControl(SUPERSEDED_BY_URL)
    const link = screen.getByRole('link', { name: 'https://docs.example.com/reset' })
    expect(link.getAttribute('href')).toBe('https://docs.example.com/reset')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toMatch(/\bnoopener\b/)
  })

  it('says the replacement was deleted when it is gone', async () => {
    await renderControl(SUPERSEDED_DELETED)
    expect(screen.getByText(/replacement was deleted/i)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('ArticleReviewStateControl confirmation steps', () => {
  it.each([
    ['flag', CURRENT, /^flag for review$/i, REVIEW_EFFECT.flag],
    ['clear', NEEDS_REVIEW, /^clear review flag$/i, REVIEW_EFFECT.clearFlag],
    ['supersede', CURRENT, /^mark as superseded$/i, REVIEW_EFFECT.supersede],
    ['restore', SUPERSEDED_BY_ARTICLE, /^restore to answers$/i, REVIEW_EFFECT.restore],
  ] as const)('%s: says what it does to customer answers before anything is submitted', async (_n, review, opener, effect) => {
    const user = userEvent.setup()
    await renderControl(review)
    expect(effectShown(effect)).toBe(false)
    await user.click(button(opener))
    expect(effectShown(effect)).toBe(true)
    // Only this step's effect, not another action's.
    for (const other of Object.values(REVIEW_EFFECT).filter((e) => e !== effect)) expect(effectShown(other)).toBe(false)
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
  })

  it('hides the other action buttons while a step is open', async () => {
    const user = userEvent.setup()
    await renderControl(CURRENT)
    await user.click(button(/^flag for review$/i))
    expect(queryButton(/mark as superseded/i)).toBeNull()
  })

  it('cancel closes the step, discards the typed reason, and calls nothing', async () => {
    const user = userEvent.setup()
    await renderControl(CURRENT)
    await user.click(button(/^flag for review$/i))
    await user.type(noteBox(), 'draft reason')
    await user.click(button(/^cancel$/i))
    expect(screen.queryByLabelText(/reason \(optional\)/i)).toBeNull()
    expect(effectShown(REVIEW_EFFECT.flag)).toBe(false)
    await user.click(button(/^flag for review$/i))
    expect(noteBox().value).toBe('')
    expect(h.flagArticleForReviewAction).not.toHaveBeenCalled()
  })

  it('flag submits the article id and the typed reason', async () => {
    const user = userEvent.setup()
    await renderControl(CURRENT)
    await user.click(button(/^flag for review$/i))
    await user.type(noteBox(), 'Looks out of date')
    await user.click(submit(/^flag for review$/i))
    await waitFor(() => expect(h.flagArticleForReviewAction).toHaveBeenCalledOnce())
    const fd = h.flagArticleForReviewAction.mock.calls[0][1] as FormData
    expect(fd.get('articleId')).toBe('9')
    expect(fd.get('note')).toBe('Looks out of date')
  })

  it('clear and restore submit the article id to their own action', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderControl(NEEDS_REVIEW)
    await user.click(button(/^clear review flag$/i))
    await user.click(submit(/^clear review flag$/i))
    await waitFor(() => expect(h.clearReviewFlagAction).toHaveBeenCalledOnce())
    expect((h.clearReviewFlagAction.mock.calls[0][1] as FormData).get('articleId')).toBe('9')
    unmount()

    await renderControl(SUPERSEDED_BY_ARTICLE)
    await user.click(button(/^restore to answers$/i))
    await user.click(submit(/^restore to answers$/i))
    await waitFor(() => expect(h.restoreArticleAction).toHaveBeenCalledOnce())
    expect((h.restoreArticleAction.mock.calls[0][1] as FormData).get('articleId')).toBe('9')
    expect(h.flagArticleForReviewAction).not.toHaveBeenCalled()
    expect(h.supersedeArticleAction).not.toHaveBeenCalled()
  })

  it('on success closes the step and tells the page to reload', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    await renderControl(CURRENT, { onChanged })
    await user.click(button(/^flag for review$/i))
    await user.type(noteBox(), 'ok')
    await user.click(submit(/^flag for review$/i))
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByLabelText(/reason \(optional\)/i)).toBeNull())
    expect(effectShown(REVIEW_EFFECT.flag)).toBe(false)
  })

  it('on failure stays open, shows the reason as an alert, keeps the typed text, and does not reload', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    h.flagArticleForReviewAction.mockResolvedValue({ error: 'Article not found' })
    await renderControl(CURRENT, { onChanged })
    await user.click(button(/^flag for review$/i))
    await user.type(noteBox(), 'my reason')
    await user.click(submit(/^flag for review$/i))

    expect((await screen.findByRole('alert')).textContent).toBe('Article not found')
    expect(noteBox().value).toBe('my reason')
    expect(effectShown(REVIEW_EFFECT.flag)).toBe(true)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('disables the submit and cancel buttons while saving', async () => {
    const user = userEvent.setup()
    const d = deferred<{ ok: true }>()
    h.clearReviewFlagAction.mockReturnValue(d.promise)
    await renderControl(NEEDS_REVIEW)
    await user.click(button(/^clear review flag$/i))
    await user.click(submit(/^clear review flag$/i))

    const saving = (await screen.findByRole('button', { name: /saving/i })) as HTMLButtonElement
    expect(saving.disabled).toBe(true)
    expect((button(/^cancel$/i) as HTMLButtonElement).disabled).toBe(true)
    d.resolve({ ok: true })
    await waitFor(() => expect(queryButton(/saving/i)).toBeNull())
  })
})

describe('ArticleReviewStateControl supersede step', () => {
  const articleRadio = () => screen.getByRole('radio', { name: /another article/i }) as HTMLInputElement
  const urlRadio = () => screen.getByRole('radio', { name: /a documentation link/i }) as HTMLInputElement
  const articleSelect = () => screen.queryByLabelText(/replacement article/i) as HTMLSelectElement | null
  const urlInput = () => screen.queryByLabelText(/^documentation link$/i) as HTMLInputElement | null

  it('defaults to choosing an article, and lists exactly the options it was given', async () => {
    const user = userEvent.setup()
    await renderControl(CURRENT)
    await user.click(button(/^mark as superseded$/i))
    expect(articleRadio().checked).toBe(true)
    expect(urlInput()).toBeNull()
    const values = within(articleSelect()!)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean)
    expect(values).toEqual(['42', '43'])
  })

  it('switches between the article picker and the link field', async () => {
    const user = userEvent.setup()
    await renderControl(CURRENT)
    await user.click(button(/^mark as superseded$/i))
    await user.click(urlRadio())
    expect(articleSelect()).toBeNull()
    expect(urlInput()).toBeTruthy()
    await user.click(articleRadio())
    expect(articleSelect()).toBeTruthy()
    expect(urlInput()).toBeNull()
  })

  it('with no other article to choose, disables the article choice and starts on the link', async () => {
    const user = userEvent.setup()
    await renderControl(CURRENT, { options: [] })
    await user.click(button(/^mark as superseded$/i))
    expect(articleRadio().disabled).toBe(true)
    expect(urlRadio().checked).toBe(true)
    expect(urlInput()).toBeTruthy()
    expect(articleSelect()).toBeNull()
  })

  it('submits the chosen article as the replacement', async () => {
    const user = userEvent.setup()
    await renderControl(CURRENT)
    await user.click(button(/^mark as superseded$/i))
    await user.selectOptions(articleSelect()!, '43')
    await user.click(submit(/^mark as superseded$/i))
    await waitFor(() => expect(h.supersedeArticleAction).toHaveBeenCalledOnce())
    const fd = h.supersedeArticleAction.mock.calls[0][1] as FormData
    expect(fd.get('articleId')).toBe('9')
    expect(fd.get('replacementKind')).toBe('article')
    expect(fd.get('replacementArticleId')).toBe('43')
    expect(fd.get('replacementUrl')).toBeNull()
  })

  it('submits a documentation link as the replacement', async () => {
    const user = userEvent.setup()
    await renderControl(CURRENT)
    await user.click(button(/^mark as superseded$/i))
    await user.click(urlRadio())
    await user.type(urlInput()!, 'https://docs.example.com/new')
    await user.click(submit(/^mark as superseded$/i))
    await waitFor(() => expect(h.supersedeArticleAction).toHaveBeenCalledOnce())
    const fd = h.supersedeArticleAction.mock.calls[0][1] as FormData
    expect(fd.get('articleId')).toBe('9')
    expect(fd.get('replacementKind')).toBe('url')
    expect(fd.get('replacementUrl')).toBe('https://docs.example.com/new')
    expect(fd.get('replacementArticleId')).toBeNull()
  })

  it('on failure keeps the typed link and shows the error', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    h.supersedeArticleAction.mockResolvedValue({ error: 'Choose a published article or a valid link' })
    await renderControl(CURRENT, { onChanged })
    await user.click(button(/^mark as superseded$/i))
    await user.click(urlRadio())
    await user.type(urlInput()!, 'https://docs.example.com/new')
    await user.click(submit(/^mark as superseded$/i))
    expect((await screen.findByRole('alert')).textContent).toMatch(/valid link/i)
    expect(urlInput()!.value).toBe('https://docs.example.com/new')
    expect(onChanged).not.toHaveBeenCalled()
  })
})
