import { describe, expect, it } from 'vitest'
import nextConfig from '@/next.config'

describe('Permissions-Policy allows Stripe embedded checkout', () => {
  it('delegates the payment feature to self and js.stripe.com on /checkout', async () => {
    const rules = await nextConfig.headers?.()
    const rule = rules?.find((r) => new RegExp(`^${r.source}$`).test('/checkout'))
    const header = rule?.headers.find(({ key }) => key === 'Permissions-Policy')

    // payment=() (the empty allowlist) disables the Payment Request API
    // outright, including for same-origin iframes — Stripe's embedded
    // Checkout needs it to initialize even plain card entry, and mounts an
    // iframe that renders nothing, with no error anywhere, when it's blocked.
    expect(header?.value).toContain('payment=(self "https://js.stripe.com")')
  })
})
