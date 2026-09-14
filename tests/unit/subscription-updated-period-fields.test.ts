import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

/**
 * customer.subscription.updated used to read current_period_start/end off
 * the Subscription object directly. Those fields do not exist there — the
 * Stripe Node SDK's own types declare them on SubscriptionItem, not on
 * Subscription, and this repo's own production webhook logs confirmed it:
 * every delivery of this event type 500'd, every time, including retries,
 * because `new Date(undefined * 1000).toISOString()` throws on an Invalid
 * Date. That meant subscription status changes — trial-to-active, plan
 * changes, cancellations delivered via this event type — silently never
 * reached our `subscriptions` table for any org, for as long as this shipped.
 *
 * These tests drive the real route handler with a fixture shaped exactly
 * like the real payloads that triggered the bug: current_period_start/end
 * nested under items.data[0], absent from the top level.
 */

const VALID_SIG = 'valid-test-signature'

const {
  upsertSubscription,
  getSubscriptionByStripeId,
  hasProcessedWebhookEvent,
  markWebhookEventProcessed,
  pruneOldWebhookEvents,
  logger,
} = vi.hoisted(() => ({
  upsertSubscription: vi.fn(async () => {}),
  getSubscriptionByStripeId: vi.fn(async () => null),
  hasProcessedWebhookEvent: vi.fn(async () => false),
  markWebhookEventProcessed: vi.fn(async () => {}),
  pruneOldWebhookEvents: vi.fn(async () => {}),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: (body: string, sig: string) => {
        if (sig !== VALID_SIG) throw new Error('No signatures found matching the expected signature')
        return JSON.parse(body)
      },
    },
  }),
}))

vi.mock('@/lib/db/queries/billing', () => ({
  upsertSubscription,
  upsertSubscriptionAndClaimWelcome: vi.fn(async () => true),
  getSubscription: vi.fn(async () => null),
  getSubscriptionByStripeId,
  hasProcessedWebhookEvent,
  markWebhookEventProcessed,
  pruneOldWebhookEvents,
}))

vi.mock('@/lib/db/queries/members', () => ({ getOrgOwner: vi.fn(async () => null), getOrgMembers: vi.fn(async () => []) }))
vi.mock('@/lib/email/send', () => ({ sendWelcomeEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/logger', () => ({ logger }))

const ORIGINAL_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const ORIGINAL_PRICE_STANDARD = process.env.STRIPE_PRICE_STANDARD

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec-test'
  process.env.STRIPE_PRICE_STANDARD = 'price_standard_test'
  getSubscriptionByStripeId.mockResolvedValue(null)
})

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET
  if (ORIGINAL_PRICE_STANDARD === undefined) delete process.env.STRIPE_PRICE_STANDARD
  else process.env.STRIPE_PRICE_STANDARD = ORIGINAL_PRICE_STANDARD
})

async function post(event: unknown): Promise<Response> {
  const { POST } = await import('@/app/api/billing/webhook/route')
  return POST(
    new Request('https://app.example.com/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': VALID_SIG },
      body: JSON.stringify(event),
    }),
  )
}

/** Shaped like a real Stripe Subscription payload: no top-level period fields. */
function subscriptionUpdatedEvent() {
  return {
    id: 'evt_sub_period_fields',
    type: 'customer.subscription.updated',
    created: 1_700_000_000,
    data: {
      object: {
        id: 'sub_test',
        metadata: { org_id: '5' },
        status: 'active',
        customer: 'cus_test',
        cancel_at_period_end: false,
        trial_end: null,
        items: {
          data: [{
            price: { id: 'price_standard_test' },
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
          }],
        },
      },
    },
  }
}

describe('customer.subscription.updated reads period fields from the subscription item', () => {
  it('does not 500 on a real-shaped payload (current_period_start/end nested under items.data[0])', async () => {
    const res = await post(subscriptionUpdatedEvent())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
  })

  it('writes currentPeriodStart/currentPeriodEnd parsed from the item, not from the top level', async () => {
    await post(subscriptionUpdatedEvent())

    expect(upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPeriodStart: new Date(1_700_000_000 * 1000).toISOString(),
        currentPeriodEnd: new Date(1_702_592_000 * 1000).toISOString(),
      }),
    )
  })

  it('skips the write and logs rather than throwing when there is no subscription item at all', async () => {
    const event = subscriptionUpdatedEvent()
    event.data.object.items.data = []

    const res = await post(event)

    expect(res.status).toBe(200)
    expect(upsertSubscription).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })
})
