import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// NEXT_PUBLIC_APP_URL is read when the module loads, so each case sets the
// environment first and imports a fresh copy.
beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('CHECKOUT_HREF', () => {
  it('points at the app host when one is configured, so the click is a plain cross-origin navigation', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    const { CHECKOUT_HREF, DASHBOARD_HREF } = await import('@/components/marketing/nav-shared')

    expect(CHECKOUT_HREF).toBe('https://app.example.com/checkout')
    // Same host as the dashboard link, which already worked this way.
    expect(new URL(CHECKOUT_HREF).origin).toBe(new URL(DASHBOARD_HREF).origin)
  })

  it('stays a relative path when there is no separate app host', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const { CHECKOUT_HREF } = await import('@/components/marketing/nav-shared')

    expect(CHECKOUT_HREF).toBe('/checkout')
  })
})
