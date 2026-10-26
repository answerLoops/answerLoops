import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/kb/articles/[id]/history: any member of the workspace can read it,
 * the lookup is always for the session's workspace, and an article from
 * another workspace reads as not found rather than as an empty history.
 */

const h = vi.hoisted(() => ({
  access: { current: { ok: true, orgId: 7, userId: 3, role: 'member' } as unknown },
  getArticleHistory: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: vi.fn(async () => h.access.current) }))
vi.mock('@/lib/db/queries/kb-events', () => ({ getArticleHistory: h.getArticleHistory }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const call = async (id: string) => {
  const { GET } = await import('@/app/api/kb/articles/[id]/history/route')
  return GET(new NextRequest('https://app.test/api/kb/articles/x/history'), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.access.current = { ok: true, orgId: 7, userId: 3, role: 'member' }
  h.getArticleHistory.mockResolvedValue([])
})

describe('GET /api/kb/articles/[id]/history', () => {
  it('is for signed-in members only', async () => {
    h.access.current = { ok: false, error: 'Unauthorized' }
    const res = await call('5')
    expect(res.status).toBe(401)
    expect(h.getArticleHistory).not.toHaveBeenCalled()
  })

  it('lets a plain member read it (no role gate)', async () => {
    const { requireOrgAccess } = await import('@/lib/auth/org')
    await call('5')
    expect(requireOrgAccess).toHaveBeenCalledWith()
  })

  it('looks the article up in the session workspace, never one from the request', async () => {
    await call('5')
    expect(h.getArticleHistory).toHaveBeenCalledWith(5, 7)
  })

  it('returns the events', async () => {
    h.getArticleHistory.mockResolvedValue([{ id: 1, type: 'created' }])
    const res = await call('5')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ events: [{ id: 1, type: 'created' }] })
  })

  it('returns an empty list for an article that exists but has no history', async () => {
    const res = await call('5')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ events: [] })
  })

  it('says not found for an article from another workspace', async () => {
    h.getArticleHistory.mockResolvedValue(null)
    const res = await call('5')
    expect(res.status).toBe(404)
  })

  it.each(['abc', '1.5', '0', '-3'])('rejects the id "%s"', async (id) => {
    const res = await call(id)
    expect(res.status).toBe(400)
    expect(h.getArticleHistory).not.toHaveBeenCalled()
  })

  it('answers 500 without leaking details when the lookup fails', async () => {
    h.getArticleHistory.mockRejectedValue(new Error('connection string postgres://secret'))
    const res = await call('5')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('postgres://')
  })
})
