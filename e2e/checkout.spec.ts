import { test, expect } from '@playwright/test'

/**
 * The branded checkout page and the session endpoint behind it.
 *
 * Everything here is a guard, reached before any Stripe call, so none of it
 * needs Stripe configured — and none of it can be checked by reading source.
 *
 * Worth knowing while reading these: this suite is not hermetic. Next
 * auto-loads .env, and Playwright's webServer.env merges with the ambient
 * environment rather than replacing it, so a developer's local Stripe
 * configuration reaches the server under test while CI's has none. Assertions
 * here are written to hold either way; one that pins a specific
 * misconfiguration message would pass on CI and fail on a configured laptop.
 *
 * The rendered form is deliberately not exercised here. It is Stripe's iframe,
 * it needs live keys, and asserting on someone else's DOM would fail on their
 * release schedule rather than ours.
 */

const BASE = 'http://localhost:3100'

test.describe('checkout: who can reach it', () => {
  test('sends a request with no session to sign in, and remembers where it was going', async () => {
    // Raw fetch rather than the fixture request context: the fixture carries
    // the storage-state cookie, which is precisely what this asserts about.
    const res = await fetch(`${BASE}/checkout?plan=standard&interval=annual`, {
      redirect: 'manual',
    })

    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/login')
    // Without callbackUrl the visitor signs in and lands somewhere generic,
    // losing the plan they had already picked.
    expect(location).toContain('callbackUrl')
  })

  test('does not strand a deployment that has no billing at all', async ({ page }) => {
    // Self-hosted: nothing to buy, no Stripe key. Reaching /checkout by hand
    // should land in the product rather than on a checkout page that cannot
    // work or an error.
    await page.goto('/checkout?plan=standard')
    await expect(page).not.toHaveURL(/\/checkout/)
  })
})

test.describe('checkout: the session endpoint', () => {
  test('rejects a request with no session', async () => {
    const res = await fetch(`${BASE}/api/billing/checkout/embedded`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: 'standard' }),
    })
    expect(res.status).toBe(401)
  })

  test('rejects a missing plan before doing anything else', async ({ request }) => {
    const res = await request.post('/api/billing/checkout/embedded', {
      data: {},
    })
    expect(res.status()).toBe(400)
    // Same non-hermetic caveat as the file header: the route checks Stripe
    // configuration before the plan, so on a deployment with no Stripe key
    // (CI) the plan is never reached and this is the message instead.
    expect((await res.json()).error).toMatch(/Missing plan|Billing is not available/)
  })

  test('either sells or explains why not — never a 500', async ({ request }) => {
    // Deliberately not asserting a specific message. Next auto-loads .env, and
    // Playwright's webServer.env merges rather than replaces, so how much of
    // Stripe is configured here depends on the machine: a developer with a full
    // .env gets a real session, CI with none gets "billing is not available",
    // and a partial one gets "no Stripe price for this plan". All three are
    // correct behaviour. What must hold everywhere is that a valid plan id
    // produces either a usable secret or a 4xx that says what is wrong.
    const res = await request.post('/api/billing/checkout/embedded', {
      data: { planId: 'standard', interval: 'annual' },
    })

    expect(res.status(), 'a misconfigured deployment must not surface as a server error').toBeLessThan(500)

    const body = (await res.json()) as { clientSecret?: string; error?: string }
    if (res.ok()) {
      expect(body.clientSecret, 'a 200 with no secret would mount an empty form').toBeTruthy()
    } else {
      expect(body.error, 'a failed checkout must say why, or the page shows a blank box').toBeTruthy()
    }
  })

  test('answers with JSON rather than a redirect, on every path', async ({ request }) => {
    // The client parses every response as JSON. A browser redirect here — the
    // access gate's default for pages — would surface as a SyntaxError inside a
    // transition and be swallowed, leaving a dead page with no error shown.
    for (const data of [{}, { planId: 'nope' }, { planId: 'standard' }]) {
      const res = await request.post('/api/billing/checkout/embedded', { data })
      expect(res.headers()['content-type']).toContain('application/json')
      expect(res.status()).toBeLessThan(500)
    }
  })
})

test.describe('checkout: the gate does not trap anyone on it', () => {
  test('/checkout never bounces between itself and onboarding', async ({ page }) => {
    // /checkout is access-exempt, and the onboarding redirect reuses that same
    // exemption list. If those two ever disagree again, an org that is
    // unsubscribed and unonboarded ping-pongs until the browser gives up —
    // which is exactly what happened to /start-trial.
    const redirects: string[] = []
    page.on('response', (r) => {
      if ([301, 302, 307, 308].includes(r.status())) redirects.push(r.url())
    })

    // Not 'networkidle': the destination page mounts a persistent SSE
    // connection (DashboardLive), so the network never goes idle and this
    // would time out regardless of how many redirects happened. `goto`
    // already waits for 'load', by which point the redirect chain above has
    // finished — that's all this needs.
    await page.goto('/checkout?plan=standard')

    expect(redirects.length).toBeLessThan(5)
  })
})
