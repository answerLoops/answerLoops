import Stripe from 'stripe'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const createSession = vi.fn()
const getSubscription = vi.fn()
const retrieveCustomer = vi.fn()

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: createSession } },
    customers: { retrieve: retrieveCustomer },
  }),
}))
vi.mock('@/lib/db/queries/billing', () => ({ getSubscription }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/db/drizzle', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'innerJoin', 'where']) chain[method] = () => chain
  chain.limit = async () => []
  return { getDb: () => chain }
})

// Idempotency keys are bucketed to a 5-minute window (see checkoutIdempotencyKey
// in lib/billing/checkout.ts) — pin the clock so the bucket number, and the
// exact key strings asserted below, are deterministic across test runs.
const FIXED_NOW = 1_700_000_000_000 // bucket 5666666
const EXPECTED_BUCKET_KEY = 'checkout:42:standard:monthly:5666666'

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
  createSession.mockReset()
  createSession.mockResolvedValue({ url: 'https://checkout.stripe.test/session' })
  getSubscription.mockResolvedValue(null)
  retrieveCustomer.mockReset()
  retrieveCustomer.mockResolvedValue({ id: 'cus_existing' })
  process.env.STRIPE_PRICE_STANDARD = 'price_standard_test'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('new checkout customer lifecycle', () => {
  it('does not create a Stripe Customer before hosted checkout completes', async () => {
    const { createCheckoutSession } = await import('@/lib/billing/checkout')

    await createCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer_email: 'owner@example.com' }),
      { idempotencyKey: EXPECTED_BUCKET_KEY },
    )
    expect(createSession.mock.calls[0][0]).not.toHaveProperty('customer')
  })

  it('reuses the stored Stripe Customer for an existing subscriber', async () => {
    getSubscription.mockResolvedValue({ stripeCustomerId: 'cus_existing' })
    const { createCheckoutSession } = await import('@/lib/billing/checkout')

    await createCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
      { idempotencyKey: EXPECTED_BUCKET_KEY },
    )
    expect(createSession.mock.calls[0][0]).not.toHaveProperty('customer_email')
  })

  it('applies the same lifecycle to embedded checkout', async () => {
    const { createEmbeddedCheckoutSession } = await import('@/lib/billing/checkout')

    createSession.mockResolvedValue({ client_secret: 'cs_test_secret' })
    await createEmbeddedCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer_email: 'owner@example.com' }),
      { idempotencyKey: EXPECTED_BUCKET_KEY },
    )
    expect(createSession.mock.calls[0][0]).not.toHaveProperty('customer')
  })

  it('uses the same idempotency key when checkout is requested again within the window', async () => {
    const { createCheckoutSession } = await import('@/lib/billing/checkout')

    await createCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')
    vi.setSystemTime(FIXED_NOW + 60_000) // still inside the 5-minute bucket
    await createCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')

    expect(createSession).toHaveBeenCalledTimes(2)
    expect(createSession.mock.calls[0][1]).toEqual(createSession.mock.calls[1][1])
    expect(createSession.mock.calls[0][1]).toEqual({ idempotencyKey: EXPECTED_BUCKET_KEY })
  })

  it('uses a different idempotency key once the window has passed', async () => {
    // This is the actual bug fix: a checkout.session that has gone stale
    // (expired, completed, or abandoned) must not be replayed forever.
    // Confirmed live in the Stripe dashboard — a request logged "This is a
    // replay of a previous request" against the pre-fix static key, followed
    // by a 410 on that stale session's own confirm endpoint.
    const { createCheckoutSession } = await import('@/lib/billing/checkout')

    await createCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')
    vi.setSystemTime(FIXED_NOW + 6 * 60_000) // past the 5-minute bucket
    await createCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')

    expect(createSession).toHaveBeenCalledTimes(2)
    expect(createSession.mock.calls[0][1]).not.toEqual(createSession.mock.calls[1][1])
  })

  describe('a stored customer that Stripe no longer has', () => {
    const missingCustomer = () =>
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        code: 'resource_missing',
        message: "No such customer: 'cus_gone'",
      })

    beforeEach(() => {
      getSubscription.mockResolvedValue({ stripeCustomerId: 'cus_gone' })
    })

    it('falls back to customer_email for hosted checkout', async () => {
      retrieveCustomer.mockRejectedValue(missingCustomer())
      const { createCheckoutSession } = await import('@/lib/billing/checkout')

      const result = await createCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')

      expect(result.ok).toBe(true)
      expect(createSession.mock.calls[0][0]).toMatchObject({ customer_email: 'owner@example.com' })
      expect(createSession.mock.calls[0][0]).not.toHaveProperty('customer')
    })

    it('falls back to customer_email for embedded checkout', async () => {
      retrieveCustomer.mockRejectedValue(missingCustomer())
      createSession.mockResolvedValue({ client_secret: 'cs_test_secret' })
      const { createEmbeddedCheckoutSession } = await import('@/lib/billing/checkout')

      const result = await createEmbeddedCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')

      expect(result).toEqual({ ok: true, clientSecret: 'cs_test_secret' })
      expect(createSession.mock.calls[0][0]).toMatchObject({ customer_email: 'owner@example.com' })
      expect(createSession.mock.calls[0][0]).not.toHaveProperty('customer')
    })

    it('treats a deleted customer the same as a missing one', async () => {
      retrieveCustomer.mockResolvedValue({ id: 'cus_gone', deleted: true })
      const { createCheckoutSession } = await import('@/lib/billing/checkout')

      await createCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')

      expect(createSession.mock.calls[0][0]).not.toHaveProperty('customer')
    })

    it('does not swallow other Stripe failures', async () => {
      retrieveCustomer.mockRejectedValue(new Error('network down'))
      const { createEmbeddedCheckoutSession } = await import('@/lib/billing/checkout')

      const result = await createEmbeddedCheckoutSession(42, 'standard', 'owner@example.com', 'Owner')

      expect(result.ok).toBe(false)
      expect(createSession).not.toHaveBeenCalled()
    })
  })
})
