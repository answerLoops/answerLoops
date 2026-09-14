import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Covers the line that decides what a customer is charged.
 *
 * The resolver is tested separately in billing-interval.test.ts, but a correct
 * resolver nobody calls is worth nothing — this asserts the price id reaching
 * Stripe's line_items is the one for the interval that was chosen. That is the
 * single value standing between the figure on the pricing page and the amount
 * on somebody's card.
 *
 * The alternative to these tests is clicking through a live checkout, which
 * costs real money to get wrong and cannot be repeated cheaply on every change.
 */

const createSession = vi.fn()
const getSubscription = vi.fn(async () => null)

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({ checkout: { sessions: { create: createSession } } }),
}))
vi.mock('@/lib/db/queries/billing', () => ({ getSubscription }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// The owner lookup is a chained query builder; every link returns itself until
// the terminal await, which yields no rows so the fallback email/name are used.
vi.mock('@/lib/db/drizzle', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'from', 'innerJoin', 'where']) chain[m] = () => chain
  chain.limit = async () => []
  return { getDb: () => chain }
})

const ANNUAL = 'price_annual_test'
const MONTHLY = 'price_monthly_test'

beforeEach(() => {
  vi.resetModules()
  createSession.mockReset()
  createSession.mockResolvedValue({ url: 'https://checkout.stripe.test/session' })
  process.env.STRIPE_PRICE_STANDARD = MONTHLY
  process.env.STRIPE_PRICE_STANDARD_ANNUAL = ANNUAL
})

/** The price id handed to Stripe for the most recent call. */
function chargedPrice(): string {
  return createSession.mock.calls[0][0].line_items[0].price
}

describe('createCheckoutSession charges the interval that was chosen', () => {
  it('uses the annual price when annual is selected', async () => {
    const { createCheckoutSession } = await import('@/lib/billing/checkout')
    const result = await createCheckoutSession(1, 'standard', 'a@example.com', 'A', 'annual')
    expect(result.ok).toBe(true)
    expect(chargedPrice()).toBe(ANNUAL)
  })

  it('uses the monthly price when monthly is selected', async () => {
    const { createCheckoutSession } = await import('@/lib/billing/checkout')
    await createCheckoutSession(1, 'standard', 'a@example.com', 'A', 'monthly')
    expect(chargedPrice()).toBe(MONTHLY)
  })

  it('defaults to monthly when no interval is given', async () => {
    // Existing callers pass four arguments. Defaulting to the lower amount is
    // the safer direction if one is ever missed.
    const { createCheckoutSession } = await import('@/lib/billing/checkout')
    await createCheckoutSession(1, 'standard', 'a@example.com', 'A')
    expect(chargedPrice()).toBe(MONTHLY)
  })
})

describe('createCheckoutSession refuses rather than substituting a price', () => {
  it('declines annual when the plan has no annual price, without calling Stripe', async () => {
    // The failure this exists to prevent: annual selected, no annual price
    // configured, and the customer quietly billed the monthly amount while the
    // page showed a yearly total.
    delete process.env.STRIPE_PRICE_STANDARD_ANNUAL
    const { createCheckoutSession } = await import('@/lib/billing/checkout')
    const result = await createCheckoutSession(1, 'standard', 'a@example.com', 'A', 'annual')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('declines monthly when the plan has no monthly price', async () => {
    delete process.env.STRIPE_PRICE_STANDARD
    const { createCheckoutSession } = await import('@/lib/billing/checkout')
    const result = await createCheckoutSession(1, 'standard', 'a@example.com', 'A', 'monthly')
    expect(result.ok).toBe(false)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('still declines an unknown plan', async () => {
    const { createCheckoutSession } = await import('@/lib/billing/checkout')
    const result = await createCheckoutSession(1, 'nonexistent', 'a@example.com', 'A', 'annual')
    expect(result.ok).toBe(false)
    expect(createSession).not.toHaveBeenCalled()
  })
})
