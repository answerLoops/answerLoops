import { describe, it, expect, vi, beforeEach } from 'vitest'

// getSubscription / getSubscriptionByStripeId are the one place every access
// check reads from, so the expiry of the app-run trial lives there. Rows are
// faked at the drizzle select boundary; the status route and the access
// helpers are exercised on top of the real query layer.

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], mode: 'cloud' }))

vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => h.rows }) }) }) }),
}))
vi.mock('@/lib/billing/plans', async (orig) => ({
  ...(await orig<typeof import('@/lib/billing/plans')>()),
  getDeploymentMode: () => h.mode,
}))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: async () => ({ ok: true, orgId: 7 }) }))
vi.mock('@/lib/billing/usage', () => ({ checkDeflectionLimit: async () => ({ planId: 'pro', used: 3, limit: 100 }) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { getSubscription, getSubscriptionByStripeId } from '@/lib/db/queries/billing'
import { orgHasProductAccess, orgIsOnAppTrial } from '@/lib/billing/access'
import { GET } from '@/app/api/billing/status/route'

const FUTURE = new Date(Date.now() + 5 * 86_400_000).toISOString()
const PAST = new Date(Date.now() - 1000).toISOString()

function row(over: Record<string, unknown> = {}) {
  return {
    id: 1, orgId: 7, planId: 'pro', status: 'trialing',
    stripeCustomerId: null, stripeSubscriptionId: null, stripePriceId: null,
    currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: 0,
    trialEndsAt: FUTURE, lastEventCreated: null, createdAt: 'x', updatedAt: 'x',
    ...over,
  }
}

beforeEach(() => {
  h.rows = []
  h.mode = 'cloud'
})

describe('getSubscription status for an app-run trial', () => {
  it('stays trialing while the window is open', async () => {
    h.rows = [row()]
    expect((await getSubscription(7))?.status).toBe('trialing')
  })

  it('reads as trial_expired once the end date has passed, on both lookups', async () => {
    h.rows = [row({ trialEndsAt: PAST })]
    expect((await getSubscription(7))?.status).toBe('trial_expired')
    expect((await getSubscriptionByStripeId('sub_x'))?.status).toBe('trial_expired')
  })

  it('fails closed when the trial has no end date or an unreadable one', async () => {
    h.rows = [row({ trialEndsAt: null })]
    expect((await getSubscription(7))?.status).toBe('trial_expired')
    h.rows = [row({ trialEndsAt: 'not a date' })]
    expect((await getSubscription(7))?.status).toBe('trial_expired')
  })

  it('leaves a Stripe-backed trialing row alone even if its end date has passed', async () => {
    h.rows = [row({ trialEndsAt: PAST, stripeSubscriptionId: 'sub_1' })]
    expect((await getSubscription(7))?.status).toBe('trialing')
  })

  it.each(['active', 'past_due', 'canceled', 'incomplete'])('does not rewrite a %s row', async (status) => {
    h.rows = [row({ status, trialEndsAt: PAST, stripeSubscriptionId: 'sub_1' })]
    expect((await getSubscription(7))?.status).toBe(status)
    h.rows = [row({ status, trialEndsAt: null })]
    expect((await getSubscription(7))?.status).toBe(status)
  })

  it('returns null when there is no row', async () => {
    expect(await getSubscription(7)).toBeNull()
  })
})

describe('access follows the effective status', () => {
  it('grants access during the trial and removes it the moment it ends', async () => {
    h.rows = [row()]
    expect(await orgHasProductAccess(7)).toBe(true)
    h.rows = [row({ trialEndsAt: PAST })]
    expect(await orgHasProductAccess(7)).toBe(false)
  })

  it('self-hosted is never gated, even on an expired row', async () => {
    h.mode = 'self-hosted'
    h.rows = [row({ trialEndsAt: PAST })]
    expect(await orgHasProductAccess(7)).toBe(true)
    expect(await orgIsOnAppTrial(7)).toBe(false)
  })

  it('orgIsOnAppTrial is true only for a trialing row with no Stripe subscription', async () => {
    h.rows = [row()]
    expect(await orgIsOnAppTrial(7)).toBe(true)
    h.rows = [row({ stripeSubscriptionId: 'sub_1' })]
    expect(await orgIsOnAppTrial(7)).toBe(false)
    h.rows = [row({ status: 'active', stripeSubscriptionId: 'sub_1' })]
    expect(await orgIsOnAppTrial(7)).toBe(false)
    h.rows = []
    expect(await orgIsOnAppTrial(7)).toBe(false)
  })
})

describe('GET /api/billing/status isAppTrial', () => {
  const body = async () => (await GET()).json()

  it('flags a running app trial', async () => {
    h.rows = [row()]
    expect(await body()).toMatchObject({ status: 'trialing', isTrialing: true, isAppTrial: true, trialEndsAt: FUTURE })
  })

  it('reports an expired app trial as trial_expired and no longer trialing', async () => {
    h.rows = [row({ trialEndsAt: PAST })]
    expect(await body()).toMatchObject({ status: 'trial_expired', isTrialing: false, isAppTrial: false })
  })

  it('does not flag a Stripe-backed trial or a paid plan, which still have a billing portal', async () => {
    h.rows = [row({ stripeSubscriptionId: 'sub_1' })]
    expect(await body()).toMatchObject({ status: 'trialing', isTrialing: true, isAppTrial: false })
    h.rows = [row({ status: 'active', stripeSubscriptionId: 'sub_1', trialEndsAt: null })]
    expect(await body()).toMatchObject({ status: 'active', isAppTrial: false })
  })

  it('reports none and isAppTrial false when the org has no subscription', async () => {
    expect(await body()).toMatchObject({ status: 'none', isTrialing: false, isAppTrial: false, trialEndsAt: null })
  })
})
