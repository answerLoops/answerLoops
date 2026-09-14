import { test, expect } from '@playwright/test'

// Billing: /api/billing/status, /api/billing/checkout, /api/billing/portal.
// Stripe is not connected in test env — checkout/portal return errors, but
// /api/billing/status works since it only reads the DB.

test.describe('billing: status endpoint', () => {
  test('returns plan info for authenticated user', async ({ request }) => {
    const res = await request.get('/api/billing/status')
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as {
      planId: string | null
      status: string
      used: number
      limit: number | null
    }
    expect(typeof body.status).toBe('string')
    expect(typeof body.used).toBe('number')
  })

  test('requires authentication', async () => {
    const res = await fetch('http://localhost:3100/api/billing/status')
    expect(res.status).toBe(401)
  })
})

test.describe('billing: checkout endpoint', () => {
  test('requires authentication', async () => {
    const res = await fetch('http://localhost:3100/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: 'pro' }),
    })
    expect(res.status).toBe(401)
  })

  test('returns 400 for an unrecognized plan id', async ({ request }) => {
    // There is no free tier — 'hobby' isn't a real plan anymore, so this now
    // exercises getPlan() returning null rather than "plan has no Stripe price".
    const res = await request.post('/api/billing/checkout', {
      data: { planId: 'hobby' },
    })
    expect(res.status()).toBe(400)
  })

  test('returns error when STRIPE_SECRET_KEY is not set', async ({ request }) => {
    // In test env STRIPE_SECRET_KEY is not configured
    const res = await request.post('/api/billing/checkout', {
      data: { planId: 'pro' },
    })
    // Either 500 (no key) or 400 (no price) — both are valid test outcomes
    expect([400, 500]).toContain(res.status())
  })
})

test.describe('billing: portal endpoint', () => {
  test('requires authentication', async () => {
    const res = await fetch('http://localhost:3100/api/billing/portal', {
      method: 'POST',
    })
    expect(res.status).toBe(401)
  })

  test('returns error when no subscription exists', async ({ request }) => {
    // No subscription seeded → portal returns error
    const res = await request.post('/api/billing/portal')
    expect([400, 404, 500]).toContain(res.status())
  })
})

test.describe('billing: UI page', () => {
  test('billing page renders plan info', async ({ page }) => {
    await page.goto('/billing')
    await expect(page.getByRole('heading', { name: /billing|plan/i })).toBeVisible()
  })
})
