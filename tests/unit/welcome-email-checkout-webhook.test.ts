import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

/**
 * The welcome email now leaves from POST /api/billing/webhook, on
 * `checkout.session.completed`, instead of from account creation. These tests
 * drive the real route handler against fakes and assert on what it actually
 * did, rather than on how the file reads — tests/unit/welcome-email.test.ts
 * already pins the source shape, and shape assertions cannot see the property
 * that matters here.
 *
 * That property is exactly-once. It is enforced by the event-id dedup table
 * for repeated deliveries and by the transaction-level org lock used when a
 * checkout first creates a subscription. The latter matters because two
 * different checkout events can arrive concurrently for the same org.
 *
 * The fake billing store below is stateful precisely so the first-subscription
 * claim remains observable in these route-level tests.
 *
 * Signature verification is the one thing stubbed rather than exercised: the
 * route delegates it wholesale to `getStripe().webhooks.constructEvent`, so
 * the mock throws for a bad signature and parses the body for a good one,
 * which is what the real call does. The 400-on-bad-signature path is still
 * driven through the handler below; what is not tested here is Stripe's HMAC
 * itself, which is the SDK's code and not ours.
 */

const VALID_SIG = 'valid-test-signature'

const {
  store,
  upsertSubscription,
  upsertSubscriptionAndClaimWelcome,
  getSubscription,
  getSubscriptionByStripeId,
  hasProcessedWebhookEvent,
  markWebhookEventProcessed,
  pruneOldWebhookEvents,
  getOrgOwner,
  getOrgMembers,
  sendWelcomeEmail,
  logger,
} = vi.hoisted(() => {
  const store = {
    subsByOrg: new Map<number, Record<string, unknown>>(),
    processedEvents: new Set<string>(),
  }
  return {
    store,
    // Stateful on purpose: the read-before-write ordering in the handler is
    // only observable against a store that remembers the write.
    upsertSubscription: vi.fn(async (row: { orgId: number }) => {
      store.subsByOrg.set(row.orgId, row as Record<string, unknown>)
    }),
    upsertSubscriptionAndClaimWelcome: vi.fn(async (row: { orgId: number }) => {
      const isFirst = !store.subsByOrg.has(row.orgId)
      store.subsByOrg.set(row.orgId, row as Record<string, unknown>)
      return isFirst
    }),
    getSubscription: vi.fn(async (orgId: number) => store.subsByOrg.get(orgId) ?? null),
    getSubscriptionByStripeId: vi.fn(async () => null),
    hasProcessedWebhookEvent: vi.fn(async (id: string) => store.processedEvents.has(id)),
    markWebhookEventProcessed: vi.fn(async (id: string) => {
      store.processedEvents.add(id)
    }),
    pruneOldWebhookEvents: vi.fn(async () => {}),
    getOrgOwner: vi.fn(async (_orgId: number): Promise<{ email: string | null; name: string | null } | null> => null),
    getOrgMembers: vi.fn(async () => []),
    sendWelcomeEmail: vi.fn(async () => {}),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
})

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
  upsertSubscriptionAndClaimWelcome,
  getSubscription,
  getSubscriptionByStripeId,
  hasProcessedWebhookEvent,
  markWebhookEventProcessed,
  pruneOldWebhookEvents,
}))

vi.mock('@/lib/db/queries/members', () => ({ getOrgOwner, getOrgMembers }))
vi.mock('@/lib/email/send', () => ({ sendWelcomeEmail, SUPPORT_EMAIL: 'support@answerloops.com' }))
vi.mock('@/lib/logger', () => ({ logger }))

const ORIGINAL_SECRET = process.env.STRIPE_WEBHOOK_SECRET

interface CheckoutOpts {
  id?: string
  orgId?: number | null
  planId?: string | null
  mode?: string
  created?: number
  customerEmail?: string | null
  customerName?: string | null
}

function checkoutEvent(opts: CheckoutOpts = {}) {
  const {
    id = 'evt_checkout_1',
    orgId = 42,
    planId = 'standard',
    mode = 'subscription',
    created = 1_700_000_000,
    customerEmail = 'billing@corp.example',
    customerName = 'Corp Accounts Payable',
  } = opts
  return {
    id,
    type: 'checkout.session.completed',
    created,
    data: {
      object: {
        mode,
        metadata: {
          ...(orgId === null ? {} : { org_id: String(orgId) }),
          ...(planId === null ? {} : { plan_id: planId }),
        },
        customer: 'cus_test',
        subscription: 'sub_test',
        customer_details:
          customerEmail === null && customerName === null
            ? {}
            : { email: customerEmail, name: customerName },
      },
    },
  }
}

async function post(event: unknown, sig: string = VALID_SIG): Promise<Response> {
  const { POST } = await import('@/app/api/billing/webhook/route')
  return POST(
    new Request('https://app.example.com/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': sig },
      body: JSON.stringify(event),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  store.subsByOrg.clear()
  store.processedEvents.clear()
  upsertSubscriptionAndClaimWelcome.mockImplementation(async (row: { orgId: number }) => {
    const isFirst = !store.subsByOrg.has(row.orgId)
    store.subsByOrg.set(row.orgId, row as Record<string, unknown>)
    return isFirst
  })
  getOrgOwner.mockResolvedValue(null)
  sendWelcomeEmail.mockResolvedValue(undefined)
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec-test'
})

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET
})

describe('checkout webhook: a customer is welcomed exactly once, ever', () => {
  it('welcomes the org owner on its first subscription', async () => {
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada Lovelace' })

    const res = await post(checkoutEvent())

    expect(res.status).toBe(200)
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
    // Addressed to the account, not to the card. `billing@corp.example` is the
    // address Stripe collected and is deliberately not the one used.
    expect(sendWelcomeEmail).toHaveBeenCalledWith('ada@example.com', 'Ada Lovelace')
    expect(store.subsByOrg.get(42)).toBeTruthy()
  })

  it('does not send again when Stripe redelivers the same event', async () => {
    // Stripe retries on any non-2xx and on a timeout it never saw the 2xx for,
    // so the identical event id arriving twice is routine, not exotic.
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })
    const event = checkoutEvent({ id: 'evt_retried' })

    const first = await post(event)
    const second = await post(event)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ received: true, duplicate: true })
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
  })

  it('does not send again when the same org subscribes a second time', async () => {
    // Cancel, come back a month later, subscribe again: a brand-new event id
    // the dedup table has never seen, for a customer who is not new. Only the
    // pre-existing-subscription read catches this one.
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })

    await post(checkoutEvent({ id: 'evt_first', created: 1_700_000_000 }))
    const resub = await post(checkoutEvent({ id: 'evt_resubscribe', created: 1_800_000_000 }))

    expect(resub.status).toBe(200)
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
    // The resubscribe still has to be applied — suppressing the email must not
    // suppress the subscription write.
    expect(upsertSubscriptionAndClaimWelcome).toHaveBeenCalledTimes(2)
  })

  it('sends nothing for an org that already had a subscription row before this event', async () => {
    // The same property as above, entered from the other side: the row exists
    // before the handler is ever called, as it would after any earlier
    // checkout, upgrade, or manual provisioning.
    store.subsByOrg.set(42, { orgId: 42, planId: 'standard', status: 'canceled' })
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })

    const res = await post(checkoutEvent({ id: 'evt_returning' }))

    expect(res.status).toBe(200)
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(upsertSubscriptionAndClaimWelcome).toHaveBeenCalledTimes(1)
  })

  it('uses the atomic first-subscription claim for checkout completion', async () => {
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })

    await post(checkoutEvent())

    expect(upsertSubscriptionAndClaimWelcome).toHaveBeenCalledTimes(1)
    expect(upsertSubscriptionAndClaimWelcome).toHaveBeenCalledWith(expect.objectContaining({ orgId: 42 }))
  })

  it('sends only one welcome when concurrent checkout events target one org', async () => {
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })

    let claimed = false
    upsertSubscriptionAndClaimWelcome.mockImplementation(async () => {
      if (claimed) return false
      claimed = true
      await new Promise((resolve) => setTimeout(resolve, 5))
      return true
    })

    await Promise.all([
      post(checkoutEvent({ id: 'evt_concurrent_1' })),
      post(checkoutEvent({ id: 'evt_concurrent_2' })),
    ])

    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
  })

  it('welcomes each org separately', async () => {
    // The gate is per-org state, not a module-level flag: one org subscribing
    // must not consume another org's welcome.
    getOrgOwner.mockImplementation(async (orgId: number) =>
      orgId === 42 ? { email: 'ada@example.com', name: 'Ada' } : { email: 'grace@example.com', name: 'Grace' },
    )

    await post(checkoutEvent({ id: 'evt_org42', orgId: 42 }))
    await post(checkoutEvent({ id: 'evt_org43', orgId: 43 }))

    expect(sendWelcomeEmail).toHaveBeenCalledTimes(2)
    expect(sendWelcomeEmail.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'ada@example.com',
      'grace@example.com',
    ])
  })
})

describe('checkout webhook: the welcome email can never cost a retry', () => {
  it('still returns 200 and keeps the subscription when the mail provider throws', async () => {
    // A non-2xx here makes Stripe redeliver an event whose subscription is
    // already written, over an email. The trial must survive the outage.
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })
    sendWelcomeEmail.mockRejectedValue(new Error('provider is down'))

    const res = await post(checkoutEvent())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(store.subsByOrg.get(42)).toBeTruthy()
    expect(store.processedEvents.has('evt_checkout_1'), 'the event must be marked processed').toBe(true)
    expect(logger.error).toHaveBeenCalled()
  })

  it('still returns 200 when the owner lookup throws', async () => {
    getOrgOwner.mockRejectedValue(new Error('connection terminated unexpectedly'))

    const res = await post(checkoutEvent())

    expect(res.status).toBe(200)
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(store.subsByOrg.get(42)).toBeTruthy()
  })

  it('does not retroactively send on a redelivery after a mail failure', async () => {
    // The failure mode this rules out: a swallowed error leaves the org
    // looking un-welcomed, and if the dedup or the subscription read were
    // missing, the next redelivery would try again — and keep trying, once per
    // Stripe retry, until one of them lands in the customer's inbox as a
    // duplicate.
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })
    sendWelcomeEmail.mockRejectedValueOnce(new Error('provider is down'))
    const event = checkoutEvent({ id: 'evt_mail_failed' })

    await post(event)
    await post(event)

    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
  })
})

describe('checkout webhook: which address the welcome goes to', () => {
  it('falls back to the checkout address when the org has no owner row', async () => {
    // Better a reachable stranger than no welcome at all — but only when our
    // own records have nothing to offer.
    getOrgOwner.mockResolvedValue(null)

    await post(checkoutEvent({ customerEmail: 'payer@example.com', customerName: 'Payer' }))

    expect(sendWelcomeEmail).toHaveBeenCalledWith('payer@example.com', 'Payer')
  })

  it('keeps the owner address while borrowing a name from Stripe', async () => {
    // Not every OAuth provider supplies a display name. The address and the
    // name resolve independently, so a nameless owner still gets the email at
    // the right address rather than falling through to the billing contact.
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: null })

    await post(checkoutEvent({ customerEmail: 'payer@example.com', customerName: 'Payer' }))

    expect(sendWelcomeEmail).toHaveBeenCalledWith('ada@example.com', 'Payer')
  })

  it('sends nothing, and warns, when there is no address anywhere', async () => {
    getOrgOwner.mockResolvedValue({ email: null, name: null })

    const res = await post(checkoutEvent({ customerEmail: null, customerName: null }))

    expect(res.status).toBe(200)
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('checkout webhook: events that are not a first subscription send nothing', () => {
  it('ignores a one-off payment session', async () => {
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })

    await post(checkoutEvent({ mode: 'payment' }))

    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(upsertSubscription).not.toHaveBeenCalled()
  })

  it('ignores a session with no org in its metadata', async () => {
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })

    await post(checkoutEvent({ orgId: null }))

    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(upsertSubscription).not.toHaveBeenCalled()
  })

  it('welcomes nobody when the plan is unrecognized and access is refused', async () => {
    // The handler 500s here so Stripe retries while the plan mapping is fixed.
    // A welcome sent from a request that granted nothing would be a lie, and
    // it would also burn the one send before the successful retry arrives.
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })

    const res = await post(checkoutEvent({ planId: 'legacy-tier' }))

    expect(res.status).toBe(500)
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(upsertSubscription).not.toHaveBeenCalled()
  })

  it('does not welcome on subscription lifecycle events', async () => {
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })

    // current_period_start/end deliberately live under items.data[0], not at
    // the top level — matching real Stripe payloads. A fixture with those
    // fields at the top level (the old shape here) would mask the bug this
    // exact shape once caused: see 'reads current_period_start/end from the
    // subscription item' below.
    await post({
      id: 'evt_sub_updated',
      type: 'customer.subscription.updated',
      created: 1_700_000_000,
      data: {
        object: {
          id: 'sub_test',
          metadata: { org_id: '42' },
          status: 'active',
          customer: 'cus_test',
          cancel_at_period_end: false,
          trial_end: null,
          items: {
            data: [{
              price: { id: 'price_unmapped' },
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_000_000,
            }],
          },
        },
      },
    })

    expect(sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it('welcomes nobody on a request that fails signature verification', async () => {
    getOrgOwner.mockResolvedValue({ email: 'ada@example.com', name: 'Ada' })

    const res = await post(checkoutEvent(), 'forged-signature')

    expect(res.status).toBe(400)
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(upsertSubscription).not.toHaveBeenCalled()
  })
})

describe('sendWelcomeEmail still has the signature its new caller relies on', () => {
  /**
   * The function did not change; only its call site did. That is exactly the
   * situation where a later signature change goes unnoticed — the old caller
   * in auth.ts is gone, so nothing else in the codebase would break first, and
   * the webhook's `try`/`catch` would swallow a TypeError from a wrong-arity
   * call and log it as a mail failure. The welcome would simply stop arriving,
   * silently, for every new customer.
   */
  const ORIGINAL_KEY = process.env.RESEND_API_KEY

  it('takes (email, name) and returns a promise, with a nullable name', async () => {
    delete process.env.RESEND_API_KEY // no key: returns before touching a provider
    try {
      const actual = await vi.importActual<typeof import('@/lib/email/send')>('@/lib/email/send')

      expect(typeof actual.sendWelcomeEmail).toBe('function')
      expect(actual.sendWelcomeEmail.length, 'arity drifted from (email, name)').toBe(2)

      const returned = actual.sendWelcomeEmail('ada@example.com', 'Ada Lovelace')
      expect(returned).toBeInstanceOf(Promise)
      await expect(returned).resolves.toBeUndefined()
      // The webhook passes null whenever neither our records nor Stripe supply
      // a name, so null has to be an accepted argument and not just a type.
      await expect(actual.sendWelcomeEmail('ada@example.com', null)).resolves.toBeUndefined()
    } finally {
      if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY
      else process.env.RESEND_API_KEY = ORIGINAL_KEY
    }
  })

  it('is the export the webhook imports by that exact name', async () => {
    const actual = await vi.importActual<typeof import('@/lib/email/send')>('@/lib/email/send')
    expect(Object.keys(actual)).toContain('sendWelcomeEmail')
  })
})
