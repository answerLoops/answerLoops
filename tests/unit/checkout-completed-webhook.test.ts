import { describe, it, expect, vi, beforeEach } from 'vitest'

// checkout.session.completed after the move to a card-free, app-run trial: a
// completed checkout is always a purchase. Access follows what Stripe says
// about the money, the app trial window is cleared, and a stale event cannot
// overwrite newer state. The route is invoked for real with Stripe and the
// database faked.

const h = vi.hoisted(() => ({
  event: null as unknown,
  existing: null as null | { lastEventCreated: number | null },
  upsertWelcome: vi.fn(),
  upsert: vi.fn(),
  release: vi.fn(),
  welcome: vi.fn(),
}))

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => h.event } }),
}))
vi.mock('@/lib/db/queries/billing', () => ({
  upsertSubscription: h.upsert,
  upsertSubscriptionAndClaimWelcome: h.upsertWelcome,
  getSubscription: async () => h.existing,
  getSubscriptionByStripeId: async () => null,
  claimWebhookEvent: async () => true,
  releaseWebhookEventClaim: h.release,
  pruneOldWebhookEvents: async () => undefined,
}))
vi.mock('@/lib/db/queries/members', () => ({ getOrgOwner: async () => ({ email: 'owner@acme.io', name: 'Pat' }) }))
vi.mock('@/lib/email/send', () => ({ sendWelcomeEmail: h.welcome }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { POST } from '@/app/api/billing/webhook/route'

function checkout(over: Record<string, unknown> = {}, created = 2000) {
  h.event = {
    id: 'evt_1',
    type: 'checkout.session.completed',
    created,
    data: {
      object: {
        mode: 'subscription',
        payment_status: 'paid',
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: { org_id: '7', plan_id: 'pro' },
        customer_details: { email: 'pay@acme.io', name: 'Pat' },
        ...over,
      },
    },
  }
}
const send = () =>
  POST(new Request('https://app.test/api/billing/webhook', { method: 'POST', headers: { 'stripe-signature': 't' }, body: '{}' }))

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder'
  h.existing = null
  h.upsertWelcome.mockReset().mockResolvedValue(true)
  h.upsert.mockReset()
  h.release.mockReset().mockResolvedValue(undefined)
  h.welcome.mockReset()
})

describe('POST /api/billing/webhook checkout.session.completed', () => {
  it.each([
    ['paid', 'active'],
    ['no_payment_required', 'active'],
    ['unpaid', 'incomplete'],
  ])('payment_status %s is stored as %s', async (payment_status, status) => {
    checkout({ payment_status })
    expect((await send()).status).toBe(200)
    expect(h.upsertWelcome).toHaveBeenCalledTimes(1)
    expect(h.upsertWelcome.mock.calls[0][0]).toMatchObject({ orgId: 7, status, stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })
  })

  it('never stores trialing, whatever Stripe reports', async () => {
    for (const payment_status of ['paid', 'no_payment_required', 'unpaid']) {
      checkout({ payment_status })
      await send()
    }
    for (const [arg] of h.upsertWelcome.mock.calls) expect(arg.status).not.toBe('trialing')
  })

  it('clears the app trial window so a paid subscription never reads as a trial', async () => {
    checkout()
    await send()
    const arg = h.upsertWelcome.mock.calls[0][0]
    expect(arg).toHaveProperty('trialEndsAt', null)
    expect(arg.lastEventCreated).toBe(2000)
  })

  it('welcomes the owner once on a first subscription and not on a later one', async () => {
    checkout()
    await send()
    expect(h.welcome).toHaveBeenCalledWith('owner@acme.io', 'Pat')
    h.welcome.mockClear()
    h.upsertWelcome.mockResolvedValue(false)
    await send()
    expect(h.welcome).not.toHaveBeenCalled()
  })

  it('skips a stale event instead of overwriting newer state, but still acknowledges it', async () => {
    h.existing = { lastEventCreated: 3000 }
    checkout({}, 2999)
    const res = await send()
    expect(res.status).toBe(200)
    expect(h.upsertWelcome).not.toHaveBeenCalled()
    checkout({}, 3000)
    await send()
    expect(h.upsertWelcome).not.toHaveBeenCalled()
  })

  it('applies an event newer than the last one recorded', async () => {
    h.existing = { lastEventCreated: 3000 }
    checkout({}, 3001)
    await send()
    expect(h.upsertWelcome).toHaveBeenCalledTimes(1)
  })

  it('refuses an unknown plan id with a 500 and releases the claim, granting nothing', async () => {
    checkout({ metadata: { org_id: '7', plan_id: 'retired-plan' } })
    const res = await send()
    expect(res.status).toBe(500)
    expect(h.upsertWelcome).not.toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledWith('evt_1')
  })

  it('ignores non-subscription sessions and sessions with no org', async () => {
    checkout({ mode: 'payment' })
    await send()
    checkout({ metadata: { plan_id: 'pro' } })
    await send()
    expect(h.upsertWelcome).not.toHaveBeenCalled()
  })

  it('releases the claim when the write fails so Stripe\'s retry is processed', async () => {
    checkout()
    h.upsertWelcome.mockRejectedValue(new Error('db down'))
    expect((await send()).status).toBe(500)
    expect(h.release).toHaveBeenCalledWith('evt_1')
  })
})
