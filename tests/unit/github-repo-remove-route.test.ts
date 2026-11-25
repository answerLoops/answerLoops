import { describe, it, expect, vi, beforeEach } from 'vitest'

// Removing a connected repository is limited to owners and admins, like every
// other GitHub setting, and only acts inside the caller's workspace.

const h = vi.hoisted(() => ({ requireOrgAccess: vi.fn(), removeRepo: vi.fn() }))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/github', () => ({ removeRepo: h.removeRepo }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/request-id', () => ({ getRequestId: () => 'req' }))

import { DELETE } from '@/app/api/github/repos/[id]/route'

const del = (id = '4') => DELETE(new Request(`http://x/api/github/repos/${id}`, { method: 'DELETE' }) as never, { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'owner' })
  h.removeRepo.mockResolvedValue(undefined)
})

describe('DELETE /api/github/repos/[id]', () => {
  it('asks for an owner or admin', async () => {
    await del()
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('refuses anyone else with 403 and removes nothing', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const res = await del()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.removeRepo).not.toHaveBeenCalled()
  })

  it('returns 401 when not signed in', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect((await del()).status).toBe(401)
  })

  it('removes the repo within the caller\'s workspace', async () => {
    const res = await del('4')
    expect(res.status).toBe(200)
    expect(h.removeRepo).toHaveBeenCalledWith(4, 7)
  })

  it('rejects an id that is not a number', async () => {
    expect((await del('abc')).status).toBe(400)
    expect(h.removeRepo).not.toHaveBeenCalled()
  })
})
