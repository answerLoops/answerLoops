import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * lib/actions/kb.ts verifyArticleAction: marking an article as checked. It
 * writes to the team's knowledge base history, so it is limited to owners and
 * admins, scoped to the session's workspace and user, validated and rate
 * limited, and must not leak internals when the write fails.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  rateLimitShared: vi.fn(),
  verifyArticle: vi.fn(),
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
  verifyArticle: h.verifyArticle,
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

async function run(fields: Record<string, string> = { articleId: '7' }) {
  const { verifyArticleAction } = await import('@/lib/actions/kb')
  return verifyArticleAction(null, form(fields))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 3, role: 'admin' })
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.verifyArticle.mockResolvedValue({ verifiedAt: '2026-10-21T00:00:00.000Z', contentHash: 'h' })
})

describe('verifyArticleAction', () => {
  it('requires an owner or admin', async () => {
    await run()
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('refuses an unauthenticated caller and a member, writing nothing', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect(await run()).toEqual({ error: 'Unauthorized' })
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await run()).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.verifyArticle).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it("verifies the article as the session's user in the session's workspace, ignoring ids in the form", async () => {
    expect(await run({ articleId: '42', note: 'Checked against v2.4', orgId: '999', userId: '999' })).toEqual({ ok: true })
    expect(h.verifyArticle).toHaveBeenCalledExactlyOnceWith({ articleId: 42, userId: 3, note: 'Checked against v2.4' }, 7)
    expect(h.refresh).toHaveBeenCalledOnce()
  })

  it('trims the note, and treats a missing or blank note as none', async () => {
    await run({ articleId: '7', note: '  checked  ' })
    expect(h.verifyArticle.mock.calls[0][0]).toMatchObject({ note: 'checked' })
    h.verifyArticle.mockClear()
    await run({ articleId: '7' })
    expect(h.verifyArticle.mock.calls[0][0]).toMatchObject({ note: '' })
  })

  it.each(['', 'abc', '0', '-3', '1.5'])('rejects the article id %j without writing', async (id) => {
    expect(await run({ articleId: id })).toEqual({ error: expect.any(String) })
    expect(h.verifyArticle).not.toHaveBeenCalled()
  })

  it('rejects a missing article id', async () => {
    expect(await run({})).toEqual({ error: expect.any(String) })
    expect(h.verifyArticle).not.toHaveBeenCalled()
  })

  it('rejects a note over 500 characters and accepts exactly 500', async () => {
    expect(await run({ articleId: '7', note: 'x'.repeat(501) })).toEqual({ error: 'Keep the note under 500 characters' })
    expect(h.verifyArticle).not.toHaveBeenCalled()
    expect(await run({ articleId: '7', note: 'x'.repeat(500) })).toEqual({ ok: true })
  })

  it('stops a workspace that is verifying too fast, before writing', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false })
    expect(await run()).toEqual({ error: 'You are verifying too quickly. Try again in a few minutes.' })
    expect(h.rateLimitShared).toHaveBeenCalledWith('kb-verify:7', 120, 600_000)
    expect(h.verifyArticle).not.toHaveBeenCalled()
  })

  it('reports an article that is not in this workspace as not found, without refreshing the page', async () => {
    h.verifyArticle.mockResolvedValue(null)
    expect(await run()).toEqual({ error: 'Article not found' })
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('hides the cause of a failed write and logs it', async () => {
    h.verifyArticle.mockRejectedValue(new Error('connection refused at 10.0.0.5'))
    const out = await run()
    expect(out).toEqual({ error: 'Could not mark this as verified. Try again.' })
    expect(JSON.stringify(out)).not.toContain('10.0.0.5')
    expect(h.loggerError).toHaveBeenCalledOnce()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})
