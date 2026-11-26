import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/kb: the can_supersede viewer flag decides whether the dashboard
 * shows the supersede and restore controls. Only owners and admins may use
 * them (the actions enforce it too), so a plain member must see false.
 */

type Access = { ok: true; orgId: number; userId: number; role: string } | { ok: false; error: string }

const h = vi.hoisted(() => ({
  member: { current: { role: 'owner' } as { role: string } | null },
  listArticles: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({
  requireOrgAccess: vi.fn(async (allowed?: string[]): Promise<Access> => {
    if (!h.member.current) return { ok: false, error: 'Unauthorized' }
    if (allowed && !allowed.includes(h.member.current.role)) return { ok: false, error: 'You do not have permission to do that.' }
    return { ok: true, orgId: 7, userId: 3, role: h.member.current.role }
  }),
}))
vi.mock('@/lib/db/queries/kb', () => ({ listArticles: h.listArticles }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const list = async () => {
  const { GET } = await import('@/app/api/kb/route')
  return GET(new Request('https://app.test/api/kb'))
}
const rows = async () => (await (await list()).json()) as Array<{ id: number; can_supersede: boolean; question: string }>

beforeEach(() => {
  vi.clearAllMocks()
  h.member.current = { role: 'owner' }
  h.listArticles.mockResolvedValue([
    { id: 1, question: 'q' },
    { id: 2, question: 'r' },
  ])
})

describe('GET /api/kb can_supersede', () => {
  it.each(['owner', 'admin'])('is true on every article for an %s', async (role) => {
    h.member.current = { role }
    const out = await rows()
    expect(out).toHaveLength(2)
    expect(out.every((a) => a.can_supersede === true)).toBe(true)
  })

  it('is false on every article for a plain member, who can still list them', async () => {
    h.member.current = { role: 'member' }
    const out = await rows()
    expect(out).toHaveLength(2)
    expect(out.every((a) => a.can_supersede === false)).toBe(true)
  })

  it('lists for the session workspace and keeps every other field', async () => {
    const out = await rows()
    expect(h.listArticles).toHaveBeenCalledWith(true, 7)
    expect(out.map((a) => [a.id, a.question])).toEqual([
      [1, 'q'],
      [2, 'r'],
    ])
  })

  it('refuses a signed-out caller without listing', async () => {
    h.member.current = null
    expect((await list()).status).toBe(401)
    expect(h.listArticles).not.toHaveBeenCalled()
  })
})
