import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * app/api/kb/review — the review queue for unseen questions. Both routes are
 * org-scoped, Pro-gated, and only owners/admins can publish or dismiss items.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  orgHasFeature: vi.fn(),
  countReviewItems: vi.fn(),
  listReviewItems: vi.fn(),
  approveReviewItem: vi.fn(),
  rejectReviewItem: vi.fn(),
  reopenReviewItem: vi.fn(),
  countArticles: vi.fn(),
  embedText: vi.fn(),
  rateLimitShared: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/kb-review', () => ({
  MAX_PENDING_REVIEW_ITEMS: 500,
  countReviewItems: h.countReviewItems,
  listReviewItems: h.listReviewItems,
  approveReviewItem: h.approveReviewItem,
  rejectReviewItem: h.rejectReviewItem,
  reopenReviewItem: h.reopenReviewItem,
}))
vi.mock('@/lib/db/queries/kb', () => ({ countArticles: h.countArticles }))
vi.mock('@/lib/ai/embed', () => ({ embedTextWithModel: async (text: string, orgId?: number) => ({ embedding: await h.embedText(text, orgId), model: 'test-embedding' }) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))

const counts = { pending: 2, approved: 1, rejected: 0 }
const ctx = (id = '5') => ({ params: Promise.resolve({ id }) })
const getReq = (qs = '') => new NextRequest(`https://app.test/api/kb/review${qs}`)
const patchReq = (body: unknown) =>
  new NextRequest('https://app.test/api/kb/review/5', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const approve = { action: 'approve', question: 'How do I reset my password?', answer: 'Use the reset link on the sign-in page.' }

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 3, role: 'admin' })
  h.orgHasFeature.mockResolvedValue(true)
  h.countReviewItems.mockResolvedValue(counts)
  h.listReviewItems.mockResolvedValue([])
  h.countArticles.mockResolvedValue(10)
  h.embedText.mockResolvedValue([0.1, 0.2])
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.approveReviewItem.mockResolvedValue({ ok: true, articleId: 42 })
  h.rejectReviewItem.mockResolvedValue({ ok: true })
  h.reopenReviewItem.mockResolvedValue({ ok: true })
})

describe('GET /api/kb/review', () => {
  it('401s and reads nothing without org access', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const { GET } = await import('@/app/api/kb/review/route')
    const res = await GET(getReq())
    expect(res.status).toBe(401)
    expect(h.countReviewItems).not.toHaveBeenCalled()
    expect(h.listReviewItems).not.toHaveBeenCalled()
  })

  it('403s and reads nothing for a member who is not an owner or admin', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { GET } = await import('@/app/api/kb/review/route')
    const res = await GET(getReq())
    expect(res.status).toBe(403)
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(h.countReviewItems).not.toHaveBeenCalled()
    expect(h.listReviewItems).not.toHaveBeenCalled()
  })

  it('reports full when the pending queue is at its ceiling', async () => {
    h.countReviewItems.mockResolvedValue({ pending: 500, approved: 0, rejected: 0 })
    const { GET } = await import('@/app/api/kb/review/route')
    expect(await (await GET(getReq())).json()).toMatchObject({ full: true })
    h.countReviewItems.mockResolvedValue({ pending: 499, approved: 0, rejected: 0 })
    expect(await (await GET(getReq())).json()).toMatchObject({ full: false })
  })

  it('402s with the required plan, and reads nothing, when the plan lacks the feature', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { GET } = await import('@/app/api/kb/review/route')
    const res = await GET(getReq())
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ locked: true, requiredPlan: 'pro' })
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'kb_review_queue')
    expect(h.listReviewItems).not.toHaveBeenCalled()
  })

  it("lists the caller's own org's pending items by default, with counts", async () => {
    h.listReviewItems.mockResolvedValue([{ id: 1, question: 'q' }])
    const { GET } = await import('@/app/api/kb/review/route')
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(h.listReviewItems).toHaveBeenCalledWith(7, 'pending', 100)
    expect(h.countReviewItems).toHaveBeenCalledWith(7)
    expect(await res.json()).toEqual({ counts, items: [{ id: 1, question: 'q' }], full: false })
  })

  it('honours the status filter and clamps limit to its ceiling', async () => {
    const { GET } = await import('@/app/api/kb/review/route')
    await GET(getReq('?status=rejected&limit=9999'))
    expect(h.listReviewItems).toHaveBeenCalledWith(7, 'rejected', 200)
  })

  it('limit=0 returns counts without loading any items', async () => {
    const { GET } = await import('@/app/api/kb/review/route')
    const res = await GET(getReq('?limit=0'))
    expect(h.listReviewItems).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ counts, items: [], full: false })
  })

  it('400s on an unknown status', async () => {
    const { GET } = await import('@/app/api/kb/review/route')
    const res = await GET(getReq('?status=all'))
    expect(res.status).toBe(400)
    expect(h.listReviewItems).not.toHaveBeenCalled()
  })

  it('500s with a generic message when the read fails', async () => {
    h.countReviewItems.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/kb/review/route')
    const res = await GET(getReq())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('db down')
  })
})

describe('PATCH /api/kb/review/[id]', () => {
  it('requires an owner or admin', async () => {
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    await PATCH(patchReq(approve), ctx())
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('401s an unauthenticated caller and 403s a member', async () => {
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect((await PATCH(patchReq(approve), ctx())).status).toBe(401)
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect((await PATCH(patchReq(approve), ctx())).status).toBe(403)
    expect(h.approveReviewItem).not.toHaveBeenCalled()
  })

  it('402s when the plan lacks the feature', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    const res = await PATCH(patchReq(approve), ctx())
    expect(res.status).toBe(402)
    expect(h.approveReviewItem).not.toHaveBeenCalled()
  })

  it('400s on a bad id, an unknown action, and an approve with no answer', async () => {
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    expect((await PATCH(patchReq(approve), ctx('abc'))).status).toBe(400)
    expect((await PATCH(patchReq({ action: 'delete' }), ctx())).status).toBe(400)
    const noAnswer = await PATCH(patchReq({ ...approve, answer: '   ' }), ctx())
    expect(noAnswer.status).toBe(400)
    expect((await noAnswer.json()).error).toMatch(/answer/i)
    expect(h.approveReviewItem).not.toHaveBeenCalled()
    expect(h.embedText).not.toHaveBeenCalled()
  })

  it('approving embeds the EDITED text and publishes it for the caller org and user', async () => {
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    const res = await PATCH(patchReq(approve), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, articleId: 42 })
    expect(h.embedText).toHaveBeenCalledWith(`${approve.question}\n\n${approve.answer}`, 7)
    expect(h.approveReviewItem).toHaveBeenCalledWith(
      { id: 5, question: approve.question, answer: approve.answer, embedding: [0.1, 0.2], model: 'test-embedding', reviewedBy: 3 },
      7
    )
  })

  it('refuses to approve into a full knowledge base', async () => {
    h.countArticles.mockResolvedValue(2000)
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    const res = await PATCH(patchReq(approve), ctx())
    expect(res.status).toBe(400)
    expect(h.approveReviewItem).not.toHaveBeenCalled()
  })

  it('429s when approvals are rate limited, before spending an embedding', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false })
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    const res = await PATCH(patchReq(approve), ctx())
    expect(res.status).toBe(429)
    expect(h.embedText).not.toHaveBeenCalled()
  })

  it('502s without publishing when the embedding fails', async () => {
    h.embedText.mockRejectedValue(new Error('provider down'))
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    const res = await PATCH(patchReq(approve), ctx())
    expect(res.status).toBe(502)
    expect(h.approveReviewItem).not.toHaveBeenCalled()
  })

  it('explains, with a 400, when knowledge-base processing is used up, and publishes nothing', async () => {
    const { PlatformBudgetExhaustedError } = await import('@/lib/ai/errors')
    const err = new PlatformBudgetExhaustedError(7, 'embedding', 'plan')
    h.embedText.mockRejectedValue(err)
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    const res = await PATCH(patchReq(approve), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(err.userMessage)
    expect(h.approveReviewItem).not.toHaveBeenCalled()
  })

  it('409s when the item was already reviewed and 404s when it does not exist in this org', async () => {
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    h.approveReviewItem.mockResolvedValue({ ok: false, reason: 'not_pending' })
    expect((await PATCH(patchReq(approve), ctx())).status).toBe(409)
    h.approveReviewItem.mockResolvedValue({ ok: false, reason: 'not_found' })
    expect((await PATCH(patchReq(approve), ctx())).status).toBe(404)
  })

  it('reject and reopen go through the org-scoped transitions without embedding anything', async () => {
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    expect((await PATCH(patchReq({ action: 'reject' }), ctx())).status).toBe(200)
    expect(h.rejectReviewItem).toHaveBeenCalledWith(5, 7, 3)
    expect((await PATCH(patchReq({ action: 'reopen' }), ctx())).status).toBe(200)
    expect(h.reopenReviewItem).toHaveBeenCalledWith(5, 7, 3)
    expect(h.embedText).not.toHaveBeenCalled()
  })

  it('409s a reject of an item that is no longer pending', async () => {
    h.rejectReviewItem.mockResolvedValue({ ok: false, reason: 'not_pending' })
    const { PATCH } = await import('@/app/api/kb/review/[id]/route')
    expect((await PATCH(patchReq({ action: 'reject' }), ctx())).status).toBe(409)
  })
})
