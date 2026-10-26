import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/kb/articles/[id]/answers: owners and admins only, always for the
 * session's workspace, and an article from another workspace reads as not found
 * rather than as an empty list. Also checks the list route's viewer flag, which
 * decides whether the dashboard shows the control at all.
 */

type Access = { ok: true; orgId: number; userId: number; role: string } | { ok: false; error: string }

const h = vi.hoisted(() => ({
  roles: { current: ['owner', 'admin'] as string[] },
  member: { current: { role: 'owner' } as { role: string } | null },
  getArticleAnswerView: vi.fn(),
  listArticles: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({
  // Applies the real rule: the caller's role must be in the allowed list.
  requireOrgAccess: vi.fn(async (allowed?: string[]): Promise<Access> => {
    if (!h.member.current) return { ok: false, error: 'Unauthorized' }
    if (allowed && !allowed.includes(h.member.current.role)) return { ok: false, error: 'You do not have permission to do that.' }
    return { ok: true, orgId: 7, userId: 3, role: h.member.current.role }
  }),
}))
vi.mock('@/lib/db/queries/kb-answers', () => ({ getArticleAnswerView: h.getArticleAnswerView }))
vi.mock('@/lib/db/queries/kb', () => ({ listArticles: h.listArticles }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const call = async (id: string) => {
  const { GET } = await import('@/app/api/kb/articles/[id]/answers/route')
  return GET(new NextRequest('https://app.test/api/kb/articles/x/answers'), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.member.current = { role: 'owner' }
  h.getArticleAnswerView.mockResolvedValue([])
  h.listArticles.mockResolvedValue([{ id: 1, question: 'q' }, { id: 2, question: 'r' }])
})

describe('GET /api/kb/articles/[id]/answers', () => {
  it.each(['owner', 'admin'])('lets an %s read it', async (role) => {
    h.member.current = { role }
    const res = await call('5')
    expect(res.status).toBe(200)
  })

  it('refuses a plain member, without reading any answers', async () => {
    h.member.current = { role: 'member' }
    const res = await call('5')
    expect(res.status).toBe(403)
    expect(h.getArticleAnswerView).not.toHaveBeenCalled()
  })

  it('refuses someone who is not signed in', async () => {
    h.member.current = null
    const res = await call('5')
    expect(res.status).toBe(401)
    expect(h.getArticleAnswerView).not.toHaveBeenCalled()
  })

  it('asks for owners and admins specifically', async () => {
    const { requireOrgAccess } = await import('@/lib/auth/org')
    await call('5')
    expect(requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('looks the article up in the session workspace, never one from the request', async () => {
    await call('5')
    expect(h.getArticleAnswerView).toHaveBeenCalledWith(5, 7)
  })

  it('returns the answers', async () => {
    h.getArticleAnswerView.mockResolvedValue([{ answer_id: 'a', surface: 'widget', revision: 'current' }])
    const res = await call('5')
    expect(await res.json()).toEqual({ answers: [{ answer_id: 'a', surface: 'widget', revision: 'current' }] })
  })

  it('returns an empty list for an article nothing was supplied to', async () => {
    const res = await call('5')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ answers: [] })
  })

  it('says not found for an article from another workspace', async () => {
    h.getArticleAnswerView.mockResolvedValue(null)
    const res = await call('5')
    expect(res.status).toBe(404)
  })

  it.each(['abc', '1.5', '0', '-3'])('rejects the id "%s"', async (id) => {
    const res = await call(id)
    expect(res.status).toBe(400)
    expect(h.getArticleAnswerView).not.toHaveBeenCalled()
  })

  it('answers 500 without leaking details when the lookup fails', async () => {
    h.getArticleAnswerView.mockRejectedValue(new Error('connection string postgres://secret'))
    const res = await call('5')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('postgres://')
  })
})

describe('GET /api/kb marks which viewers may see answers', () => {
  const list = async () => {
    const { GET } = await import('@/app/api/kb/route')
    return (await (await GET(new Request('https://app.test/api/kb'))).json()) as Array<{ id: number; can_view_answers: boolean }>
  }

  it.each(['owner', 'admin'])('sets the flag for an %s', async (role) => {
    h.member.current = { role }
    expect((await list()).every((a) => a.can_view_answers === true)).toBe(true)
  })

  it('clears the flag for a plain member', async () => {
    h.member.current = { role: 'member' }
    const out = await list()
    expect(out).toHaveLength(2)
    expect(out.every((a) => a.can_view_answers === false)).toBe(true)
  })

  it('keeps every other field of each article', async () => {
    const out = (await list()) as unknown as Array<{ id: number; question: string }>
    expect(out.map((a) => [a.id, a.question])).toEqual([[1, 'q'], [2, 'r']])
  })
})
