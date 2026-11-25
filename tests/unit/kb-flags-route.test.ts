import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * app/api/kb/flags: flagged widget answers. Both routes are org-scoped, gated to
 * the plans with the review queue, and limited to owners and admins, since the
 * items carry text typed by visitors.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  orgHasFeature: vi.fn(),
  countFlags: vi.fn(),
  listFlags: vi.fn(),
  resolveFlag: vi.fn(),
  dismissFlag: vi.fn(),
  reopenFlag: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/widget-answer-flags', () => ({
  countFlags: h.countFlags,
  listFlags: h.listFlags,
  resolveFlag: h.resolveFlag,
  dismissFlag: h.dismissFlag,
  reopenFlag: h.reopenFlag,
}))

const counts = { open: 2, resolved: 1, dismissed: 0 }
const ctx = (id = '5') => ({ params: Promise.resolve({ id }) })
const getReq = (qs = '') => new NextRequest(`https://app.test/api/kb/flags${qs}`)
const patchReq = (body: unknown) =>
  new NextRequest('https://app.test/api/kb/flags/5', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 3, role: 'admin' })
  h.orgHasFeature.mockResolvedValue(true)
  h.countFlags.mockResolvedValue(counts)
  h.listFlags.mockResolvedValue([])
  h.resolveFlag.mockResolvedValue({ ok: true })
  h.dismissFlag.mockResolvedValue({ ok: true })
  h.reopenFlag.mockResolvedValue({ ok: true })
})

describe('GET /api/kb/flags', () => {
  it('401s and reads nothing without org access', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const { GET } = await import('@/app/api/kb/flags/route')
    expect((await GET(getReq())).status).toBe(401)
    expect(h.countFlags).not.toHaveBeenCalled()
    expect(h.listFlags).not.toHaveBeenCalled()
  })

  it('403s and reads nothing for a member who is not an owner or admin', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { GET } = await import('@/app/api/kb/flags/route')
    expect((await GET(getReq())).status).toBe(403)
    expect(h.listFlags).not.toHaveBeenCalled()
  })

  it('asks for owners and admins only', async () => {
    const { GET } = await import('@/app/api/kb/flags/route')
    await GET(getReq())
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('402s with the plan that has it, and reads nothing, on a plan without the review queue', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { GET } = await import('@/app/api/kb/flags/route')
    const res = await GET(getReq())
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ locked: true, requiredPlan: expect.any(String) })
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'kb_review_queue')
    expect(h.listFlags).not.toHaveBeenCalled()
  })

  it('lists open flags for this workspace by default, with the counts', async () => {
    h.listFlags.mockResolvedValue([{ id: 1 }])
    const { GET } = await import('@/app/api/kb/flags/route')
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ counts, items: [{ id: 1 }] })
    expect(h.listFlags).toHaveBeenCalledWith(7, 'open', 100)
    expect(h.countFlags).toHaveBeenCalledWith(7)
  })

  it.each(['open', 'resolved', 'dismissed'])('lists the %s status', async (status) => {
    const { GET } = await import('@/app/api/kb/flags/route')
    await GET(getReq(`?status=${status}`))
    expect(h.listFlags).toHaveBeenCalledWith(7, status, 100)
  })

  it('400s for a status that is not one of them', async () => {
    const { GET } = await import('@/app/api/kb/flags/route')
    expect((await GET(getReq('?status=pending'))).status).toBe(400)
    expect(h.listFlags).not.toHaveBeenCalled()
  })

  it('returns the counts alone for limit=0, and caps a large limit', async () => {
    const { GET } = await import('@/app/api/kb/flags/route')
    const res = await GET(getReq('?limit=0'))
    expect(await res.json()).toEqual({ counts, items: [] })
    expect(h.listFlags).not.toHaveBeenCalled()
    await GET(getReq('?limit=5000'))
    expect(h.listFlags).toHaveBeenCalledWith(7, 'open', 200)
  })

  it('500s without leaking the error when a query fails', async () => {
    h.countFlags.mockRejectedValue(new Error('connection string postgres://secret'))
    const { GET } = await import('@/app/api/kb/flags/route')
    const res = await GET(getReq())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})

describe('PATCH /api/kb/flags/[id]', () => {
  it('401s and changes nothing without org access', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const { PATCH } = await import('@/app/api/kb/flags/[id]/route')
    expect((await PATCH(patchReq({ action: 'resolve' }), ctx())).status).toBe(401)
    expect(h.resolveFlag).not.toHaveBeenCalled()
  })

  it('403s for a member who is not an owner or admin', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { PATCH } = await import('@/app/api/kb/flags/[id]/route')
    expect((await PATCH(patchReq({ action: 'dismiss' }), ctx())).status).toBe(403)
    expect(h.dismissFlag).not.toHaveBeenCalled()
  })

  it('402s and changes nothing on a plan without the review queue', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { PATCH } = await import('@/app/api/kb/flags/[id]/route')
    expect((await PATCH(patchReq({ action: 'resolve' }), ctx())).status).toBe(402)
    expect(h.resolveFlag).not.toHaveBeenCalled()
  })

  it.each([
    ['resolve', 'resolveFlag'],
    ['dismiss', 'dismissFlag'],
    ['reopen', 'reopenFlag'],
  ] as const)('%s acts on this workspace\'s flag as the signed-in person', async (action, fn) => {
    const { PATCH } = await import('@/app/api/kb/flags/[id]/route')
    const res = await PATCH(patchReq({ action }), ctx('5'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(h[fn]).toHaveBeenCalledWith(5, 7, 3)
  })

  it.each(['0', '-3', '1.5', 'abc'])('400s for the id %s', async (id) => {
    const { PATCH } = await import('@/app/api/kb/flags/[id]/route')
    expect((await PATCH(patchReq({ action: 'resolve' }), ctx(id))).status).toBe(400)
    expect(h.resolveFlag).not.toHaveBeenCalled()
  })

  it.each([{ action: 'approve' }, { action: 5 }, {}, null])('400s for the body %j', async (body) => {
    const { PATCH } = await import('@/app/api/kb/flags/[id]/route')
    expect((await PATCH(patchReq(body), ctx())).status).toBe(400)
    expect(h.resolveFlag).not.toHaveBeenCalled()
    expect(h.dismissFlag).not.toHaveBeenCalled()
    expect(h.reopenFlag).not.toHaveBeenCalled()
  })

  it('404s when the flag is not in this workspace', async () => {
    h.resolveFlag.mockResolvedValue({ ok: false, reason: 'not_found' })
    const { PATCH } = await import('@/app/api/kb/flags/[id]/route')
    expect((await PATCH(patchReq({ action: 'resolve' }), ctx())).status).toBe(404)
  })

  it('409s when someone else already handled it', async () => {
    h.resolveFlag.mockResolvedValue({ ok: false, reason: 'wrong_state' })
    const { PATCH } = await import('@/app/api/kb/flags/[id]/route')
    const res = await PATCH(patchReq({ action: 'resolve' }), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already handled/i)
  })

  it('500s without leaking the error when the update fails', async () => {
    h.dismissFlag.mockRejectedValue(new Error('relation "widget_answer_flags" does not exist'))
    const { PATCH } = await import('@/app/api/kb/flags/[id]/route')
    const res = await PATCH(patchReq({ action: 'dismiss' }), ctx())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('widget_answer_flags')
  })
})
