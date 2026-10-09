import { beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'

const auth = vi.fn()
const requireOrgAccess = vi.fn()
const getSubscription = vi.fn()
const portalCreate = vi.fn()

vi.mock('@/auth', () => ({ auth }))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess }))
vi.mock('@/lib/billing/plans', () => ({
  stripeConfigured: () => true,
  parseBillingInterval: () => 'monthly',
}))
vi.mock('@/lib/billing/checkout', () => ({ createEmbeddedCheckoutSession: vi.fn() }))
vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({ billingPortal: { sessions: { create: portalCreate } } }),
}))
vi.mock('@/lib/db/queries/billing', () => ({ getSubscription }))
vi.mock('@/lib/request-id', () => ({ getRequestId: () => 'req-test' }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/billing/checkout/embedded — never an empty body', () => {
  const post = async () => {
    const { POST } = await import('@/app/api/billing/checkout/embedded/route')
    return POST(
      new Request('http://localhost/api/billing/checkout/embedded', {
        method: 'POST',
        body: JSON.stringify({ planId: 'standard', interval: 'monthly' }),
      }),
    )
  }

  it('returns a JSON 500 when the session lookup throws', async () => {
    auth.mockRejectedValue(new Error('database unavailable'))

    const res = await post()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })

  it('returns a JSON 500 when the org lookup throws', async () => {
    auth.mockResolvedValue({ user: { email: 'owner@example.com', name: 'Owner' } })
    requireOrgAccess.mockRejectedValue(new Error('database unavailable'))

    const res = await post()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })

  it('still answers 401 for a signed-out request', async () => {
    auth.mockResolvedValue(null)

    const res = await post()

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })
})

describe('POST /api/billing/portal — a stored customer Stripe no longer has', () => {
  beforeEach(() => {
    requireOrgAccess.mockResolvedValue({ ok: true, orgId: 3 })
    getSubscription.mockResolvedValue({ stripeCustomerId: 'cus_gone' })
  })

  it('answers 404 "No billing account found", the same as having no customer', async () => {
    portalCreate.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        code: 'resource_missing',
        message: "No such customer: 'cus_gone'",
      }),
    )
    const { POST } = await import('@/app/api/billing/portal/route')

    const res = await POST()

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No billing account found' })
  })

  it('keeps the 502 for other Stripe failures', async () => {
    portalCreate.mockRejectedValue(
      new Stripe.errors.StripeAuthenticationError({
        type: 'authentication_error',
        message: 'Invalid API Key',
      }),
    )
    const { POST } = await import('@/app/api/billing/portal/route')

    const res = await POST()

    expect(res.status).toBe(502)
  })
})
