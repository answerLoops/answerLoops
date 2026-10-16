import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * lib/actions/kb.ts promoteToKBAction, getTicketDraftAction and the
 * ticket-linked path of addKnowledgeAction. Promoting publishes immediately, so
 * it is limited to owners/admins, shares the add rate limit and article cap,
 * validates the ticket id and never creates a second article for one ticket.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  rateLimitShared: vi.fn(),
  countArticles: vi.fn(),
  createArticle: vi.fn(),
  getArticleBySourceTicket: vi.fn(),
  getTicketById: vi.fn(),
  embed: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/db/queries/kb', () => ({
  countArticles: h.countArticles,
  createArticle: h.createArticle,
  getArticleBySourceTicket: h.getArticleBySourceTicket,
}))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketById: h.getTicketById }))
vi.mock('@/lib/ai/embed', () => ({
  embedTextWithModel: async (text: string, orgId?: number) => ({ embedding: await h.embed(text, orgId), model: 'test-embedding' }),
}))
vi.mock('@/lib/ai/models', () => ({ NoAIProviderConfiguredError: class extends Error {} }))
vi.mock('next/cache', () => ({ refresh: h.refresh }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('@/auth', () => ({ auth: vi.fn() }))

const ticket = {
  id: 12,
  status: 'resolved',
  content: 'How do I reset my password?',
  ai_summary: 'Password reset',
  resolution_notes: 'Use the reset link on the login page.',
  ai_draft: null,
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

async function promote(fields: Record<string, string> = { ticketId: '12' }) {
  const { promoteToKBAction } = await import('@/lib/actions/kb')
  return promoteToKBAction(null, form(fields))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 3, role: 'admin' })
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.countArticles.mockResolvedValue(10)
  h.getTicketById.mockResolvedValue(ticket)
  h.getArticleBySourceTicket.mockResolvedValue(null)
  h.embed.mockResolvedValue([0.1, 0.2])
  h.createArticle.mockResolvedValue({ id: 42 })
})

describe('promoteToKBAction', () => {
  it('requires an owner or admin and writes nothing for a member', async () => {
    expect(await promote()).toBeNull()
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])

    h.createArticle.mockClear()
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await promote()).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it.each(['0', '-3', '1.5', 'abc', ''])('rejects the ticket id %j', async (id) => {
    expect(await promote({ ticketId: id })).toEqual({ error: 'Invalid input' })
    expect(h.getTicketById).not.toHaveBeenCalled()
  })

  it('publishes the answer linked to the ticket, looked up in the session org', async () => {
    expect(await promote()).toBeNull()
    expect(h.getTicketById).toHaveBeenCalledWith(12, 7)
    expect(h.createArticle).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'Password reset', answer: ticket.resolution_notes, sourceTicketId: 12 }),
      7
    )
  })

  it('refuses a ticket that already has an article', async () => {
    h.getArticleBySourceTicket.mockResolvedValue({ id: 5 })
    expect(await promote()).toEqual({ error: 'This ticket is already in the knowledge base' })
    expect(h.getArticleBySourceTicket).toHaveBeenCalledWith(12, 7)
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it('applies the shared add rate limit', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false })
    expect(await promote()).toEqual({ error: expect.stringMatching(/too quickly/i) })
    expect(h.rateLimitShared).toHaveBeenCalledWith('kb-add:7', 30, 10 * 60_000)
    expect(h.embed).not.toHaveBeenCalled()
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it('refuses when the knowledge base is full', async () => {
    const { MAX_ARTICLES_PER_ORG } = await import('@/lib/kb/limits')
    h.countArticles.mockResolvedValue(MAX_ARTICLES_PER_ORG)
    expect(await promote()).toEqual({ error: expect.stringMatching(/full/i) })
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it('refuses an unresolved ticket and a ticket with no answer', async () => {
    h.getTicketById.mockResolvedValue({ ...ticket, status: 'open' })
    expect(await promote()).toEqual({ error: 'Only resolved tickets can be promoted' })
    h.getTicketById.mockResolvedValue({ ...ticket, resolution_notes: null })
    expect(await promote()).toEqual({ error: 'Ticket has no answer to promote' })
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it('reports a ticket from another workspace as not found', async () => {
    h.getTicketById.mockResolvedValue(null)
    expect(await promote()).toEqual({ error: 'Ticket not found' })
  })
})

describe('getTicketDraftAction', () => {
  it('requires an owner or admin', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { getTicketDraftAction } = await import('@/lib/actions/kb')
    expect(await getTicketDraftAction(12)).toEqual({ ok: false, error: 'You do not have permission to do that.' })
    expect(h.getTicketById).not.toHaveBeenCalled()
  })

  it('validates the id as a positive integer', async () => {
    const { getTicketDraftAction } = await import('@/lib/actions/kb')
    for (const bad of ['abc', '1.5', '-1', '0', null, undefined]) {
      expect(await getTicketDraftAction(bad)).toEqual({ ok: false, error: 'Invalid ticket' })
    }
    expect(h.getTicketById).not.toHaveBeenCalled()
  })

  it('returns the ticket question and answer from the session org', async () => {
    const { getTicketDraftAction } = await import('@/lib/actions/kb')
    expect(await getTicketDraftAction('12')).toEqual({
      ok: true,
      ticketId: 12,
      question: 'Password reset',
      answer: 'Use the reset link on the login page.',
    })
    expect(h.getTicketById).toHaveBeenCalledWith(12, 7)
  })

  it('returns an empty answer for a gap that has none yet, and refuses a ticket already in the KB', async () => {
    const { getTicketDraftAction } = await import('@/lib/actions/kb')
    h.getTicketById.mockResolvedValue({ ...ticket, resolution_notes: null, ai_draft: null })
    expect(await getTicketDraftAction(12)).toMatchObject({ ok: true, answer: '' })
    h.getArticleBySourceTicket.mockResolvedValue({ id: 9 })
    expect(await getTicketDraftAction(12)).toEqual({ ok: false, error: 'This ticket is already in the knowledge base' })
  })

  it('reports a ticket from another workspace as not found', async () => {
    h.getTicketById.mockResolvedValue(null)
    const { getTicketDraftAction } = await import('@/lib/actions/kb')
    expect(await getTicketDraftAction(12)).toEqual({ ok: false, error: 'Ticket not found' })
  })
})

describe('addKnowledgeAction with a source ticket', () => {
  const fields = { question: 'Q?', answer: 'A.', sourceTicketId: '12' }
  async function add(f: Record<string, string>) {
    const { addKnowledgeAction } = await import('@/lib/actions/kb')
    return addKnowledgeAction(null, form(f))
  }

  it('links the article to an org-scoped ticket', async () => {
    expect(await add(fields)).toEqual({ ok: true, articleId: 42 })
    expect(h.getTicketById).toHaveBeenCalledWith(12, 7)
    expect(h.createArticle).toHaveBeenCalledWith(expect.objectContaining({ sourceTicketId: 12 }), 7)
  })

  it('rejects an invalid, foreign or already-covered ticket without writing', async () => {
    expect(await add({ ...fields, sourceTicketId: 'x' })).toEqual({ error: 'Invalid ticket' })
    h.getTicketById.mockResolvedValue(null)
    expect(await add(fields)).toEqual({ error: 'Ticket not found' })
    h.getTicketById.mockResolvedValue(ticket)
    h.getArticleBySourceTicket.mockResolvedValue({ id: 5 })
    expect(await add(fields)).toEqual({ error: 'This ticket is already in the knowledge base' })
    expect(h.createArticle).not.toHaveBeenCalled()
  })

  it('creates an unlinked article when no ticket is given', async () => {
    await add({ question: 'Q?', answer: 'A.' })
    expect(h.createArticle.mock.calls[0][0].sourceTicketId).toBeUndefined()
    expect(h.getTicketById).not.toHaveBeenCalled()
  })
})
