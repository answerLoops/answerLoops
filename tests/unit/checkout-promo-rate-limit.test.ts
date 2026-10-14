import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.fn()
const requireOrgAccess = vi.fn()
const createEmbeddedCheckoutSession = vi.fn()
const rateLimitShared = vi.fn()

vi.mock('@/auth', () => ({ auth }))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess }))
vi.mock('@/lib/billing/plans', async (orig) => ({
  ...(await orig<typeof import('@/lib/billing/plans')>()),
  stripeConfigured: () => true,
}))
vi.mock('@/lib/billing/checkout', () => ({ createEmbeddedCheckoutSession }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const ok = { ok: true, retryAfterMs: 0, count: 1, resetAt: new Date() }
const blocked = { ok: false, retryAfterMs: 1000, count: 99, resetAt: new Date() }

beforeEach(() => {
  vi.resetModules()
  auth.mockReset().mockResolvedValue({ user: { email: 'owner@example.com', name: 'Owner' } })
  requireOrgAccess.mockReset().mockResolvedValue({ ok: true, orgId: 42 })
  createEmbeddedCheckoutSession.mockReset().mockResolvedValue({ ok: true, clientSecret: 'cs', promoStatus: 'none' })
  rateLimitShared.mockReset().mockResolvedValue(ok)
})

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/billing/checkout/embedded/route')
  return POST(
    new Request('http://localhost/api/billing/checkout/embedded', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ planId: 'standard', interval: 'monthly', ...body }),
    }),
  )
}

describe('POST /api/billing/checkout/embedded — promotion code attempts', () => {
  it('does not count or limit a request that carries no code', async () => {
    const res = await post({})

    expect(rateLimitShared).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(createEmbeddedCheckoutSession).toHaveBeenCalledWith(42, 'standard', 'owner@example.com', 'Owner', 'monthly', undefined)
  })

  it('charges both the account and the address bucket for a code attempt, and passes the code on', async () => {
    createEmbeddedCheckoutSession.mockResolvedValue({ ok: true, clientSecret: 'cs', promoStatus: 'no_card' })
    const res = await post({ promoCode: 'SOMECODE' })

    const keys = rateLimitShared.mock.calls.map((c) => c[0] as string)
    expect(keys).toEqual(
      expect.arrayContaining([
        'checkout-promo-account:42:owner@example.com',
        expect.stringMatching(/^checkout-promo-ip:/),
      ]),
    )
    expect(createEmbeddedCheckoutSession.mock.calls[0][5]).toBe('SOMECODE')
    expect(await res.json()).toEqual({ clientSecret: 'cs', promoStatus: 'no_card' })
  })

  it.each([
    ['the account bucket', [blocked, ok]],
    ['the address bucket', [ok, blocked]],
  ])('drops the code but still returns a normal session when %s is exhausted', async (_label, results) => {
    rateLimitShared.mockResolvedValueOnce(results[0]).mockResolvedValueOnce(results[1])
    const res = await post({ promoCode: 'GUESS1' })

    expect(res.status).toBe(200)
    expect(createEmbeddedCheckoutSession.mock.calls[0][5]).toBeNull()
    expect(await res.json()).toEqual({ clientSecret: 'cs', promoStatus: 'rate_limited' })
  })

  it('charges both buckets even when the first is already exhausted', async () => {
    rateLimitShared.mockResolvedValue(blocked)
    await post({ promoCode: 'GUESS2' })
    expect(rateLimitShared).toHaveBeenCalledTimes(2)
  })
})
