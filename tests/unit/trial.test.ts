import { describe, it, expect, vi, beforeEach } from 'vitest'

// The rules that make "one trial per person" hold: how an email becomes an
// identity, when an app-run trial counts as over, and how startTrial turns a
// ledger conflict into a refusal. The database is faked at the transaction
// boundary; the UNIQUE constraints themselves are asserted against the
// migration in trial-migration-infra.test.ts.

const h = vi.hoisted(() => ({
  existingSub: [] as unknown[],
  claimRows: [{ id: 1 }] as unknown[],
  subInsert: vi.fn(),
  claimInsert: vi.fn(),
  mode: 'cloud',
}))

vi.mock('@/lib/db/drizzle', () => {
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.existingSub }) }) }),
    insert: (table: { _: { name: string } } | Record<string, unknown>) => {
      const isClaims = 'identityKey' in table
      return {
        values: (v: unknown) => {
          if (isClaims) {
            h.claimInsert(v)
            return { onConflictDoNothing: () => ({ returning: async () => h.claimRows }) }
          }
          h.subInsert(v)
          return Promise.resolve()
        },
      }
    },
  }
  return { getDb: () => ({ transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) }) }
})
vi.mock('@/lib/billing/plans', async (orig) => ({
  ...(await orig<typeof import('@/lib/billing/plans')>()),
  getDeploymentMode: () => h.mode,
}))

import { normalizeIdentity, identityHash, startTrial, trialHasEnded, isAppManagedTrial, TRIAL_PLAN_ID } from '@/lib/billing/trial'

beforeEach(() => {
  h.existingSub = []
  h.claimRows = [{ id: 1 }]
  h.mode = 'cloud'
  h.subInsert.mockClear()
  h.claimInsert.mockClear()
})

describe('normalizeIdentity', () => {
  it.each([
    ['Jane.Doe@Gmail.com', 'janedoe@gmail.com'],
    ['j.a.n.e+promo@gmail.com', 'jane@gmail.com'],
    ['jane@googlemail.com', 'jane@gmail.com'],
    ['  JANE@GMAIL.COM ', 'jane@gmail.com'],
    ['jane.doe+x@acme.io', 'jane.doe@acme.io'],
    ['jane.doe+a+b@acme.io', 'jane.doe@acme.io'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeIdentity(input)).toBe(expected)
  })

  it('treats every spelling of one Gmail mailbox as the same identity', () => {
    const variants = ['jane.doe@gmail.com', 'janedoe@gmail.com', 'JaneDoe+1@gmail.com', 'jane.doe@googlemail.com']
    expect(new Set(variants.map(normalizeIdentity)).size).toBe(1)
  })

  it('keeps dots on other domains, where they can be significant', () => {
    expect(normalizeIdentity('a.b@acme.io')).not.toBe(normalizeIdentity('ab@acme.io'))
  })

  it.each([null, undefined, '', 'nope', '@x.com', 'a@', '+tag@x.com', 'a@localhost'])('rejects %s', (bad) => {
    expect(normalizeIdentity(bad as string | null | undefined)).toBeNull()
  })
})

describe('trial window', () => {
  it('is over at and after the end, and fails closed on a missing or bad date', () => {
    const now = new Date('2026-11-01T00:00:00Z')
    expect(trialHasEnded('2026-11-01T00:00:01Z', now)).toBe(false)
    expect(trialHasEnded('2026-11-01T00:00:00Z', now)).toBe(true)
    expect(trialHasEnded('2026-10-01T00:00:00Z', now)).toBe(true)
    expect(trialHasEnded(null, now)).toBe(true)
    expect(trialHasEnded('garbage', now)).toBe(true)
  })

  it('only a trialing row with no Stripe subscription is app-managed', () => {
    expect(isAppManagedTrial({ status: 'trialing', stripeSubscriptionId: null })).toBe(true)
    expect(isAppManagedTrial({ status: 'trialing', stripeSubscriptionId: 'sub_1' })).toBe(false)
    expect(isAppManagedTrial({ status: 'active', stripeSubscriptionId: null })).toBe(false)
  })
})

describe('startTrial', () => {
  const input = { orgId: 7, userId: 3, email: 'Jane.Doe+a@gmail.com', providerSubject: 'g-123' }

  it('claims the normalized identity and creates a trialing row on the top plan', async () => {
    const out = await startTrial(input)
    expect(out.status).toBe('started')
    expect(h.claimInsert).toHaveBeenCalledWith(
      expect.objectContaining({ identityKey: identityHash('janedoe@gmail.com'), providerSubject: 'g-123', orgId: 7 }),
    )
    expect(h.subInsert).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 7, planId: TRIAL_PLAN_ID, status: 'trialing' }),
    )
    expect(TRIAL_PLAN_ID).toBe('enterprise')
  })

  it('grants no subscription when the ledger already has this person', async () => {
    h.claimRows = []
    expect((await startTrial(input)).status).toBe('already-used')
    expect(h.subInsert).not.toHaveBeenCalled()
  })

  it('leaves an org that already has a subscription row alone and spends no claim', async () => {
    h.existingSub = [{ id: 1 }]
    expect((await startTrial(input)).status).toBe('already-used')
    expect(h.claimInsert).not.toHaveBeenCalled()
    expect(h.subInsert).not.toHaveBeenCalled()
  })

  it('stores a hash of the identity, never the address', async () => {
    await startTrial(input)
    const claim = h.claimInsert.mock.calls[0][0] as { identityKey: string }
    expect(claim.identityKey).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(claim)).not.toContain('gmail')
  })

  it('refuses an email with no usable identity instead of sharing a key', async () => {
    expect((await startTrial({ ...input, email: 'nope' })).status).toBe('already-used')
    expect(h.claimInsert).not.toHaveBeenCalled()
  })

  it('does nothing on a self-hosted deployment', async () => {
    h.mode = 'self-hosted'
    expect((await startTrial(input)).status).toBe('not-applicable')
    expect(h.claimInsert).not.toHaveBeenCalled()
  })
})
