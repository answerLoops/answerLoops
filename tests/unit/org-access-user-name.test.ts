import { beforeEach, describe, expect, it, vi } from 'vitest'

/** requireOrgAccess also reports who the caller is, for crediting replies and status changes. */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  membership: [{ role: 'admin' }] as Array<{ role: string }>,
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.membership }) }) }),
  }),
}))

import { requireOrgAccess } from '@/lib/auth/org'

const session = (user: Record<string, unknown>) => ({ orgId: 4, user: { id: '9', ...user } })

beforeEach(() => {
  vi.clearAllMocks()
  h.membership = [{ role: 'admin' }]
})

describe('requireOrgAccess userName', () => {
  it('is the account name', async () => {
    h.auth.mockResolvedValue(session({ name: 'Sarah Lee', email: 'sarah@example.com' }))
    expect(await requireOrgAccess()).toEqual({ ok: true, orgId: 4, userId: 9, role: 'admin', userName: 'Sarah Lee' })
  })

  it('trims the name', async () => {
    h.auth.mockResolvedValue(session({ name: '  Sarah  ', email: 'sarah@example.com' }))
    expect(await requireOrgAccess()).toMatchObject({ userName: 'Sarah' })
  })

  it('falls back to the part of the email before the @ when there is no name', async () => {
    h.auth.mockResolvedValue(session({ name: '   ', email: 'dev.person@example.com' }))
    expect(await requireOrgAccess()).toMatchObject({ userName: 'dev.person' })
  })

  it('is null when the account has neither a name nor an email', async () => {
    h.auth.mockResolvedValue(session({}))
    expect(await requireOrgAccess()).toMatchObject({ ok: true, userName: null })
  })

  it('does not report a name to someone who is not a member', async () => {
    h.membership = []
    h.auth.mockResolvedValue(session({ name: 'Sarah' }))
    expect(await requireOrgAccess()).toEqual({ ok: false, error: 'Unauthorized' })
  })
})
