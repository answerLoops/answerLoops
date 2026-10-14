import { beforeEach, describe, expect, it, vi } from 'vitest'

// resolveApiKey must compare expiry as instants, not as strings.
const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))

vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (h.row ? [h.row] : []) }) }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  }),
}))

import { resolveApiKey } from '@/lib/db/queries/api-keys'

const base = { id: 1, orgId: 5, scopes: null, revokedAt: null }

describe('resolveApiKey expiry', () => {
  beforeEach(() => {
    h.row = null
  })

  it('rejects a key whose offset-form expiry is already past', async () => {
    // 2020-01-01T01:00+05:00 is 2019-12-31T20:00Z; the string compares as
    // "later" than a UTC ISO date from 2019-12-31 yet the instant is long past.
    h.row = { ...base, expiresAt: '2020-01-01T01:00:00+05:00' }
    expect(await resolveApiKey('k')).toBeNull()
  })

  it('accepts a key expiring in the future and rejects an unparseable expiry', async () => {
    h.row = { ...base, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
    expect(await resolveApiKey('k')).toMatchObject({ orgId: 5, keyId: 1 })
    h.row = { ...base, expiresAt: 'not-a-date' }
    expect(await resolveApiKey('k')).toBeNull()
  })
})
