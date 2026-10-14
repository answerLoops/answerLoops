import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * lib/actions/kb.ts addKnowledgeAction — the dashboard's "add to the knowledge
 * base" form. It publishes immediately with no review step, so it is limited to
 * owners/admins, scoped to the session's org, validated, rate limited, capped,
 * and must not leak internals when the embedding fails.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  rateLimitShared: vi.fn(),
  countArticles: vi.fn(),
  createArticle: vi.fn(),
  embedText: vi.fn(),
  refresh: vi.fn(),
  loggerError: vi.fn(),
  NoAIProviderConfiguredError: class NoAIProviderConfiguredError extends Error {},
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/db/queries/kb', () => ({ countArticles: h.countArticles, createArticle: h.createArticle }))
vi.mock('@/lib/ai/embed', () => ({ embedTextWithModel: async (text: string, orgId?: number) => ({ embedding: await h.embedText(text, orgId), model: 'test-embedding' }) }))
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
const good = { question: 'Do you ship to Canada?', answer: 'Yes, we ship to Canada within 5 days.' }

async function run(fields: Record<string, string> = good) {
  const { addKnowledgeAction } = await import('@/lib/actions/kb')
  return addKnowledgeAction(null, form(fields))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 3, role: 'admin' })
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.countArticles.mockResolvedValue(10)
  h.embedText.mockResolvedValue([0.1, 0.2])
  h.createArticle.mockResolvedValue({ id: 42 })
})

describe('addKnowledgeAction', () => {
  it('requires an owner or admin', async () => {
    await run()
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('refuses an unauthenticated caller and a member, writing nothing', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect(await run()).toEqual({ error: 'Unauthorized' })
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await run()).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.embedText).not.toHaveBeenCalled()
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it('embeds question and answer together and publishes one article for the session org', async () => {
    const res = await run({ ...good, orgId: '999' })
    expect(res).toEqual({ ok: true, articleId: 42 })
    expect(h.embedText).toHaveBeenCalledWith(`${good.question}\n\n${good.answer}`, 7)
    expect(h.createArticle).toHaveBeenCalledExactlyOnceWith(
      { question: good.question, answer: good.answer, embedding: [0.1, 0.2], model: 'test-embedding' },
      7
    )
    expect(h.refresh).toHaveBeenCalledOnce()
  })

  it('stores trimmed text and never links the article to a ticket', async () => {
    await run({ question: `  ${good.question}  `, answer: `\n${good.answer}\n` })
    const [input] = h.createArticle.mock.calls[0]
    expect(input.question).toBe(good.question)
    expect(input.answer).toBe(good.answer)
    expect(input).not.toHaveProperty('sourceTicketId')
  })

  it('rejects a blank or whitespace-only question or answer before spending anything', async () => {
    expect(await run({ question: '   ', answer: good.answer })).toEqual({ error: 'Add a question or title' })
    expect(await run({ question: good.question, answer: '  \n ' })).toEqual({ error: 'Add the answer or context' })
    expect(h.rateLimitShared).not.toHaveBeenCalled()
    expect(h.embedText).not.toHaveBeenCalled()
  })

  it('rejects an over-long question or answer', async () => {
    const q = await run({ question: 'q'.repeat(501), answer: good.answer })
    expect(q).toMatchObject({ error: expect.stringMatching(/too long/i) })
    const a = await run({ question: good.question, answer: 'a'.repeat(8001) })
    expect(a).toMatchObject({ error: expect.stringMatching(/too long/i) })
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it('accepts text exactly at the limits', async () => {
    const res = await run({ question: 'q'.repeat(500), answer: 'a'.repeat(8000) })
    expect(res).toMatchObject({ ok: true })
  })

  it('is rate limited per org and does not embed once the limit is hit', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false })
    expect(await run()).toMatchObject({ error: expect.stringMatching(/too quickly/i) })
    expect(h.rateLimitShared).toHaveBeenCalledWith('kb-add:7', 30, 600_000)
    expect(h.embedText).not.toHaveBeenCalled()
  })

  it('refuses to add into a full knowledge base', async () => {
    h.countArticles.mockResolvedValue(2000)
    expect(await run()).toMatchObject({ error: expect.stringMatching(/full \(2000 articles\)/) })
    expect(h.embedText).not.toHaveBeenCalled()
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it('tells the user to connect an AI provider when none is configured', async () => {
    h.embedText.mockRejectedValue(new h.NoAIProviderConfiguredError('none'))
    expect(await run()).toMatchObject({ error: expect.stringContaining('Settings → AI Model') })
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it('returns a generic message, logs the cause, and does not refresh when saving fails', async () => {
    h.createArticle.mockRejectedValue(new Error('connection refused at 10.0.0.5'))
    const res = await run()
    expect(res).toEqual({ error: 'Could not add this to the knowledge base. Try again.' })
    expect(JSON.stringify(res)).not.toContain('10.0.0.5')
    expect(h.loggerError).toHaveBeenCalledOnce()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})
