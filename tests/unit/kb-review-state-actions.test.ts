import { describe, it, expect, vi, beforeEach } from 'vitest'
import { REVIEW_NOTE_MAX, REPLACEMENT_URL_MAX } from '@/lib/kb/review-state'

/**
 * lib/actions/kb.ts review-state actions. Flagging and clearing a flag leave
 * customer answers alone, so any member may do them. Superseding and restoring
 * change what customers are answered from, so only owners and admins may. All
 * four are scoped to the session's workspace and user, validated, share one
 * rate limit per workspace, and never leak internals when the write fails.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  rateLimitShared: vi.fn(),
  flagArticleForReview: vi.fn(),
  clearReviewFlag: vi.fn(),
  supersedeArticle: vi.fn(),
  restoreArticle: vi.fn(),
  refresh: vi.fn(),
  loggerError: vi.fn(),
  NoAIProviderConfiguredError: class NoAIProviderConfiguredError extends Error {},
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/db/queries/kb', () => ({
  countArticles: vi.fn(),
  createArticle: vi.fn(),
  getArticleBySourceTicket: vi.fn(),
  verifyArticle: vi.fn(),
}))
vi.mock('@/lib/db/queries/kb-review-state', () => ({
  flagArticleForReview: h.flagArticleForReview,
  clearReviewFlag: h.clearReviewFlag,
  supersedeArticle: h.supersedeArticle,
  restoreArticle: h.restoreArticle,
}))
vi.mock('@/lib/ai/embed', () => ({ embedTextWithModel: vi.fn() }))
vi.mock('@/lib/ai/models', () => ({ NoAIProviderConfiguredError: h.NoAIProviderConfiguredError }))
vi.mock('next/cache', () => ({ refresh: h.refresh }))
vi.mock('@/lib/logger', () => ({ logger: { error: h.loggerError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketById: vi.fn() }))

const form = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

type ActionName = 'flagArticleForReviewAction' | 'clearReviewFlagAction' | 'supersedeArticleAction' | 'restoreArticleAction'

async function act(name: ActionName, fields: Record<string, string>) {
  const mod = await import('@/lib/actions/kb')
  return mod[name](null, form(fields))
}

const flag = (fields: Record<string, string> = { articleId: '42' }) => act('flagArticleForReviewAction', fields)
const clear = (fields: Record<string, string> = { articleId: '42' }) => act('clearReviewFlagAction', fields)
const supersede = (fields: Record<string, string> = { articleId: '42', replacementKind: 'article', replacementArticleId: '9' }) =>
  act('supersedeArticleAction', fields)
const restore = (fields: Record<string, string> = { articleId: '42' }) => act('restoreArticleAction', fields)

/** Each action with valid input, the query it runs, and its generic failure message. */
const ACTIONS = [
  { name: 'flag', run: () => flag(), query: () => h.flagArticleForReview, failure: 'Could not flag this article. Try again.' },
  { name: 'clear', run: () => clear(), query: () => h.clearReviewFlag, failure: 'Could not clear the flag. Try again.' },
  {
    name: 'supersede',
    run: () => supersede(),
    query: () => h.supersedeArticle,
    failure: 'Could not mark this article as superseded. Try again.',
  },
  { name: 'restore', run: () => restore(), query: () => h.restoreArticle, failure: 'Could not restore this article. Try again.' },
] as const

const queries = () => [h.flagArticleForReview, h.clearReviewFlag, h.supersedeArticle, h.restoreArticle]

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 3, role: 'member' })
  h.rateLimitShared.mockResolvedValue({ ok: true })
  for (const q of queries()) q.mockResolvedValue({ ok: true })
})

describe('who may change review state', () => {
  it('lets any member flag an article or clear a flag (no role restriction)', async () => {
    await flag()
    expect(h.requireOrgAccess).toHaveBeenLastCalledWith(undefined)
    await clear()
    expect(h.requireOrgAccess).toHaveBeenLastCalledWith(undefined)
    expect(h.requireOrgAccess.mock.calls.every((c) => c[0] === undefined)).toBe(true)
  })

  it('limits superseding and restoring to owners and admins', async () => {
    await supersede()
    expect(h.requireOrgAccess).toHaveBeenLastCalledWith(['owner', 'admin'])
    await restore()
    expect(h.requireOrgAccess).toHaveBeenLastCalledWith(['owner', 'admin'])
  })

  it.each(ACTIONS)('$name: a refused caller gets the access error and nothing is written', async ({ run }) => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await run()).toEqual({ error: 'You do not have permission to do that.' })
    for (const q of queries()) expect(q).not.toHaveBeenCalled()
    expect(h.rateLimitShared).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})

describe('ids come from the form, the workspace and user from the session', () => {
  const spoof = { orgId: '999', userId: '999' }

  it('flag', async () => {
    expect(await flag({ articleId: '42', note: '  pricing changed  ', ...spoof })).toEqual({ ok: true })
    expect(h.flagArticleForReview).toHaveBeenCalledExactlyOnceWith({ articleId: 42, userId: 3, note: 'pricing changed' }, 7)
  })

  it('flag without a note sends an empty note', async () => {
    await flag({ articleId: '42' })
    expect(h.flagArticleForReview).toHaveBeenCalledExactlyOnceWith({ articleId: 42, userId: 3, note: '' }, 7)
  })

  it('clear', async () => {
    expect(await clear({ articleId: '42', ...spoof })).toEqual({ ok: true })
    expect(h.clearReviewFlag).toHaveBeenCalledExactlyOnceWith({ articleId: 42, userId: 3 }, 7)
  })

  it('supersede with an article', async () => {
    expect(await supersede({ articleId: '42', replacementKind: 'article', replacementArticleId: '9', ...spoof })).toEqual({ ok: true })
    expect(h.supersedeArticle).toHaveBeenCalledExactlyOnceWith({ articleId: 42, userId: 3, replacement: { articleId: 9 } }, 7)
  })

  it('restore', async () => {
    expect(await restore({ articleId: '42', ...spoof })).toEqual({ ok: true })
    expect(h.restoreArticle).toHaveBeenCalledExactlyOnceWith({ articleId: 42, userId: 3 }, 7)
  })

  it.each(ACTIONS)('$name rejects a bad article id without writing', async ({ name, query }) => {
    for (const id of ['', 'abc', '0', '-3', '1.5']) {
      const fields: Record<string, string> =
        name === 'supersede' ? { articleId: id, replacementKind: 'article', replacementArticleId: '9' } : { articleId: id }
      const out = await act(
        ({ flag: 'flagArticleForReviewAction', clear: 'clearReviewFlagAction', supersede: 'supersedeArticleAction', restore: 'restoreArticleAction' } as const)[name],
        fields
      )
      expect(out).toEqual({ error: expect.any(String) })
    }
    expect(query()).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})

describe('flag note length', () => {
  it(`refuses a reason over ${REVIEW_NOTE_MAX} characters with a message, and accepts exactly ${REVIEW_NOTE_MAX}`, async () => {
    expect(await flag({ articleId: '42', note: 'x'.repeat(REVIEW_NOTE_MAX + 1) })).toEqual({
      error: `Keep the reason under ${REVIEW_NOTE_MAX} characters`,
    })
    expect(h.flagArticleForReview).not.toHaveBeenCalled()
    expect(await flag({ articleId: '42', note: 'x'.repeat(REVIEW_NOTE_MAX) })).toEqual({ ok: true })
    expect(h.flagArticleForReview).toHaveBeenCalledOnce()
  })
})

describe('supersede replacement', () => {
  const byUrl = (url: string) => supersede({ articleId: '42', replacementKind: 'url', replacementUrl: url })
  const urlError = { error: 'Enter a full link that starts with http:// or https://' }

  it('passes a normalized https link', async () => {
    expect(await byUrl('  HTTPS://Docs.Example.com/guide  ')).toEqual({ ok: true })
    expect(h.supersedeArticle).toHaveBeenCalledExactlyOnceWith(
      { articleId: 42, userId: 3, replacement: { url: 'https://docs.example.com/guide' } },
      7
    )
  })

  it.each([
    ['a javascript: link', 'javascript:alert(1)'],
    ['a data: link', 'data:text/html,hi'],
    ['a relative path', '/docs/guide'],
    ['a bare host', 'docs.example.com/guide'],
    ['an empty link', ''],
    ['an over-long link', `https://docs.example.com/${'a'.repeat(REPLACEMENT_URL_MAX)}`],
  ])('rejects %s without writing', async (_label, url) => {
    expect(await byUrl(url)).toEqual(urlError)
    expect(h.supersedeArticle).not.toHaveBeenCalled()
  })

  it('rejects a url kind with no link at all', async () => {
    expect(await supersede({ articleId: '42', replacementKind: 'url' })).toEqual(urlError)
    expect(h.supersedeArticle).not.toHaveBeenCalled()
  })

  it.each(['', 'abc', '0', '-1', '2.5'])('requires a positive integer replacement article id, rejecting %j', async (id) => {
    expect(await supersede({ articleId: '42', replacementKind: 'article', replacementArticleId: id })).toEqual({
      error: 'Choose the article that replaces this one.',
    })
    expect(h.supersedeArticle).not.toHaveBeenCalled()
  })

  it('rejects a missing replacement article id', async () => {
    expect(await supersede({ articleId: '42', replacementKind: 'article' })).toEqual({
      error: 'Choose the article that replaces this one.',
    })
    expect(h.supersedeArticle).not.toHaveBeenCalled()
  })

  it.each([undefined, 'both', 'ticket'])('rejects replacementKind %j', async (kind) => {
    const fields: Record<string, string> = { articleId: '42', replacementArticleId: '9', replacementUrl: 'https://x.test' }
    if (kind !== undefined) fields.replacementKind = kind
    expect(await supersede(fields)).toEqual({ error: 'Choose what replaces this article.' })
    expect(h.supersedeArticle).not.toHaveBeenCalled()
  })

  it('uses only the field that matches the kind', async () => {
    await supersede({ articleId: '42', replacementKind: 'url', replacementUrl: 'https://docs.example.com/', replacementArticleId: '9' })
    expect(h.supersedeArticle.mock.calls[0][0].replacement).toEqual({ url: 'https://docs.example.com/' })
    await supersede({ articleId: '42', replacementKind: 'article', replacementArticleId: '9', replacementUrl: 'https://docs.example.com/' })
    expect(h.supersedeArticle.mock.calls[1][0].replacement).toEqual({ articleId: 9 })
  })
})

describe('rate limit', () => {
  it.each(ACTIONS)('$name shares the workspace budget and stops before writing', async ({ run }) => {
    h.rateLimitShared.mockResolvedValue({ ok: false })
    expect(await run()).toEqual({ error: 'You are changing articles too quickly. Try again in a few minutes.' })
    expect(h.rateLimitShared).toHaveBeenCalledExactlyOnceWith('kb-review-state:7', 120, 600_000)
    for (const q of queries()) expect(q).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('does not spend the budget on input that fails validation', async () => {
    await flag({ articleId: 'abc' })
    expect(h.rateLimitShared).not.toHaveBeenCalled()
  })
})

describe('query results', () => {
  const MESSAGES = {
    not_found: 'Article not found',
    wrong_state: 'This article changed in the meantime. Reload the page and try again.',
    invalid_replacement: 'Choose a different published article that has not been replaced itself.',
  } as const

  for (const a of ACTIONS) {
    it.each(Object.entries(MESSAGES))(`${a.name}: reason %s reads "%s" and the page is not refreshed`, async (reason, message) => {
      a.query().mockResolvedValue({ ok: false, reason })
      expect(await a.run()).toEqual({ error: message })
      expect(h.refresh).not.toHaveBeenCalled()
      expect(h.loggerError).not.toHaveBeenCalled()
    })

    it(`${a.name}: a thrown error is logged and the caller gets only the generic message`, async () => {
      a.query().mockRejectedValue(new Error('connection refused at 10.0.0.5'))
      const out = await a.run()
      expect(out).toEqual({ error: a.failure })
      expect(JSON.stringify(out)).not.toContain('10.0.0.5')
      expect(h.loggerError).toHaveBeenCalledOnce()
      expect(h.loggerError.mock.calls[0][1]).toMatchObject({ orgId: 7, error: expect.any(Error) })
      expect(h.refresh).not.toHaveBeenCalled()
    })

    it(`${a.name}: refreshes the page once on success`, async () => {
      expect(await a.run()).toEqual({ ok: true })
      expect(a.query()).toHaveBeenCalledOnce()
      expect(h.refresh).toHaveBeenCalledOnce()
    })
  }
})
