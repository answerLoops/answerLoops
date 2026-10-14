import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const createSession = vi.fn()
const listPromoCodes = vi.fn()
const getSubscription = vi.fn()

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: createSession } },
    promotionCodes: { list: listPromoCodes },
    customers: { retrieve: vi.fn() },
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

const FIXED_NOW = 1_700_000_000_000 // bucket 5666666
const PLAIN_KEY = 'checkout:42:standard:monthly:5666666'

const promo = (coupon: Record<string, unknown> | string | null) => ({
  data: [{ id: 'promo_1', promotion: { type: 'coupon', coupon } }],
})

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
  createSession.mockReset()
  createSession.mockResolvedValue({ client_secret: 'cs_secret' })
  listPromoCodes.mockReset()
  getSubscription.mockResolvedValue(null)
  process.env.STRIPE_PRICE_STANDARD = 'price_standard_test'
})

afterEach(() => {
  vi.useRealTimers()
})

async function checkout(code?: string | null) {
  const { createEmbeddedCheckoutSession } = await import('@/lib/billing/checkout')
  const result = await createEmbeddedCheckoutSession(42, 'standard', 'o@example.com', 'Owner', 'monthly', code)
  return { result, params: createSession.mock.calls[0]?.[0], options: createSession.mock.calls[0]?.[1] }
}

describe('embedded checkout with a promotion code', () => {
  it('skips the card for a 100% forever coupon and pre-applies it', async () => {
    listPromoCodes.mockResolvedValue(promo({ percent_off: 100, duration: 'forever', valid: true }))
    const { result, params, options } = await checkout('FREEACCESS')

    expect(result).toEqual({ ok: true, clientSecret: 'cs_secret', promoStatus: 'no_card' })
    expect(listPromoCodes).toHaveBeenCalledWith(expect.objectContaining({ code: 'FREEACCESS', active: true }))
    expect(params.payment_method_collection).toBe('if_required')
    expect(params.discounts).toEqual([{ promotion_code: 'promo_1' }])
    expect(options.idempotencyKey).toBe(`${PLAIN_KEY}:promo_1`)
  })

  it('also skips the card for a 100% coupon that ends, and invoices at trial end', async () => {
    listPromoCodes.mockResolvedValue(promo({ percent_off: 100, duration: 'repeating', valid: true }))
    const { params } = await checkout('SIXMONTHS')

    expect(params.payment_method_collection).toBe('if_required')
    expect(params.subscription_data.trial_settings).toEqual({
      end_behavior: { missing_payment_method: 'create_invoice' },
    })
  })

  it('applies a partial discount but still collects the card', async () => {
    listPromoCodes.mockResolvedValue(promo({ percent_off: 50, duration: 'forever', valid: true }))
    const { result, params } = await checkout('HALFOFF')

    expect(result).toMatchObject({ ok: true, promoStatus: 'applied' })
    expect(params.discounts).toEqual([{ promotion_code: 'promo_1' }])
    expect(params).not.toHaveProperty('payment_method_collection')
    expect(params.subscription_data).not.toHaveProperty('trial_settings')
  })

  it.each([
    ['a coupon that is no longer valid', { percent_off: 100, duration: 'forever', valid: false }],
    ['an unexpanded coupon id', 'coupon_id'],
  ])('treats %s as an invalid code and keeps the card', async (_label, coupon) => {
    listPromoCodes.mockResolvedValue(promo(coupon as Record<string, unknown> | string))
    const { result, params, options } = await checkout('SOMECODE')

    expect(result).toMatchObject({ ok: true, promoStatus: 'invalid' })
    expect(params).not.toHaveProperty('payment_method_collection')
    expect(params).not.toHaveProperty('discounts')
    expect(options.idempotencyKey).toBe(PLAIN_KEY)
  })

  it('reports an unknown code as invalid', async () => {
    listPromoCodes.mockResolvedValue({ data: [] })
    const { result, params } = await checkout('NOPE')
    expect(result).toMatchObject({ ok: true, promoStatus: 'invalid' })
    expect(params).not.toHaveProperty('payment_method_collection')
  })

  it('reports a Stripe failure as an error, not as a bad code, and still lets signup proceed', async () => {
    listPromoCodes.mockRejectedValue(new Error('network'))
    const { result, params } = await checkout('FREEACCESS')
    expect(result).toMatchObject({ ok: true, promoStatus: 'error' })
    expect(params).not.toHaveProperty('payment_method_collection')
  })

  it('never sends a malformed code to Stripe', async () => {
    const { result } = await checkout('bad code; drop')
    expect(listPromoCodes).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, promoStatus: 'invalid' })
  })

  it('retries without the code when Stripe refuses it for this customer', async () => {
    listPromoCodes.mockResolvedValue(promo({ percent_off: 100, duration: 'forever', valid: true }))
    const { default: Stripe } = await import('stripe')
    createSession
      .mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ message: 'not eligible', type: 'invalid_request_error' }))
      .mockResolvedValueOnce({ client_secret: 'cs_plain' })
    const { createEmbeddedCheckoutSession } = await import('@/lib/billing/checkout')
    const result = await createEmbeddedCheckoutSession(42, 'standard', 'o@example.com', 'Owner', 'monthly', 'FIRSTTIME')

    expect(result).toEqual({ ok: true, clientSecret: 'cs_plain', promoStatus: 'invalid' })
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(createSession.mock.calls[1][0]).not.toHaveProperty('discounts')
    expect(createSession.mock.calls[1][0]).not.toHaveProperty('payment_method_collection')
  })

  it('has no code, no Stripe promo box and no lookup for an ordinary checkout', async () => {
    const { result, params, options } = await checkout(null)
    expect(listPromoCodes).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, promoStatus: 'none' })
    expect(params).not.toHaveProperty('allow_promotion_codes')
    expect(params).not.toHaveProperty('payment_method_collection')
    expect(options.idempotencyKey).toBe(PLAIN_KEY)
  })
})

describe('parsePromoCode', () => {
  it('accepts normal codes and rejects everything else', async () => {
    const { parsePromoCode } = await import('@/lib/billing/promo')
    expect(parsePromoCode('FREE-2026_a')).toBe('FREE-2026_a')
    expect(parsePromoCode('')).toBeNull()
    expect(parsePromoCode(null)).toBeNull()
    expect(parsePromoCode(undefined)).toBeNull()
    expect(parsePromoCode('has space')).toBeNull()
    expect(parsePromoCode('a'.repeat(65))).toBeNull()
    expect(parsePromoCode('../etc')).toBeNull()
  })
})
