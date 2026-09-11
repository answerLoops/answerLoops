import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The hard gate: authenticating is not enough to reach the product.
 *
 * A trial requires a card up front, so an account without an active
 * subscription has not started one. Access is scoped to subscriptions rather
 * than to sessions, and the commitment of entering a card is the point — a
 * visitor who never enters one is unlikely to return.
 *
 * The same check covers cancellation. `canceled` is not an active status, so an
 * org that cancels loses access the moment Stripe says so; cancel-at-period-end
 * keeps access until the period actually ends, because it was paid for.
 */

const { getSubscription } = vi.hoisted(() => ({ getSubscription: vi.fn() }))
vi.mock('@/lib/db/queries/billing', () => ({ getSubscription }))

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.DEPLOYMENT_MODE = 'cloud'
})

afterEach(() => {
  process.env = { ...originalEnv }
})

const mod = () => import('@/lib/billing/access')

describe('orgHasProductAccess: who may use the product', () => {
  it.each([
    ['trialing', true, 'the trial is the whole point'],
    ['active', true, 'paying'],
    ['past_due', true, 'a failed charge is a dunning problem, not a reason to cut service mid-cycle'],
  ])('%s grants access (%s)', async (status, expected) => {
    getSubscription.mockResolvedValue({ status })
    const { orgHasProductAccess } = await mod()
    expect(await orgHasProductAccess(1)).toBe(expected)
  })

  it.each([
    ['canceled', 'cancelled orgs lose access'],
    ['unpaid', 'never paid'],
    ['incomplete', 'checkout never completed'],
    ['incomplete_expired', 'abandoned checkout that expired'],
  ])('%s denies access (%s)', async (status) => {
    getSubscription.mockResolvedValue({ status })
    const { orgHasProductAccess } = await mod()
    expect(await orgHasProductAccess(1)).toBe(false)
  })

  it('denies an org with no subscription row at all', async () => {
    // The state right after OAuth and before checkout. This is the case the
    // whole gate exists for.
    getSubscription.mockResolvedValue(undefined)
    const { orgHasProductAccess } = await mod()
    expect(await orgHasProductAccess(1)).toBe(false)
  })

  it('never gates a self-hosted deployment', async () => {
    // Self-hosters run on their own keys and have no subscription to hold.
    // Gating them would lock every one of them out of their own install.
    process.env.DEPLOYMENT_MODE = 'self-hosted'
    getSubscription.mockResolvedValue(undefined)
    const { orgHasProductAccess } = await mod()
    expect(await orgHasProductAccess(1)).toBe(true)
  })

  it('reads the local subscription table rather than calling Stripe', async () => {
    // Deliberate: this runs on every request, and must keep working through a
    // Stripe outage or a rotated key. The webhook keeps the table current.
    getSubscription.mockResolvedValue({ status: 'active' })
    const { orgHasProductAccess } = await mod()
    await orgHasProductAccess(1)
    expect(getSubscription).toHaveBeenCalledWith(1)
  })
})

describe('exempt paths: the gate must not trap anyone', () => {
  it.each([
    ['/start-trial', 'where the gate sends people'],
    ['/api/billing/checkout', 'creating the session'],
    ['/api/billing/status', 'the billing page reads it'],
    ['/api/billing/portal', 'a cancelled org needs it to resubscribe'],
    ['/invite/abc123', 'an invited teammate has no subscription of their own yet'],
    ['/account-deleted', 'restoring a soft-deleted org'],
  ])('%s is exempt (%s)', async (pathname) => {
    const { isAccessExempt } = await mod()
    expect(isAccessExempt(pathname)).toBe(true)
  })

  // /billing is deliberately NOT exempt. An earlier revision exempted it to
  // dodge the post-checkout race, which also handed an unsubscribed visitor a
  // page inside the dashboard shell. The race is handled at /start-trial
  // instead, so this stays closed.
  it.each(['/dashboard', '/tickets', '/kb', '/analytics', '/settings', '/onboarding', '/api/tickets', '/billing'])(
    '%s is NOT exempt',
    async (pathname) => {
      const { isAccessExempt } = await mod()
      expect(isAccessExempt(pathname)).toBe(false)
    },
  )

  it('gates onboarding, which is part of the product', async () => {
    // Onboarding connects real channels and seeds a real knowledge base, so it
    // sits inside the boundary rather than in front of it.
    const { isAccessExempt } = await mod()
    expect(isAccessExempt('/onboarding')).toBe(false)
  })
})

describe('auth.ts wires the gate into every request', () => {
  const src = () => fs.readFileSync(path.join(process.cwd(), 'auth.ts'), 'utf-8')

  it('checks access in the authorized callback', () => {
    const gate = src().slice(src().indexOf('async authorized('), src().indexOf('async jwt('))
    expect(gate).toContain('orgHasProductAccess')
    expect(gate).toContain('isAccessExempt')
  })

  it('redirects pages to /start-trial and answers APIs with 402', () => {
    const gate = src().slice(src().indexOf('async authorized('), src().indexOf('async jwt('))
    expect(gate).toContain('START_TRIAL_PATH')
    // A browser redirect for an API call would be parsed as a JSON body and
    // fail confusingly; 402 says exactly what is wrong.
    expect(gate).toContain('402')
  })

  it('checks access before the onboarding redirect', () => {
    // Textual order only. An unsubscribed user reaching /onboarding this way
    // (rather than via the loop below) would start connecting real channels
    // before ever reaching a card — but order alone does not protect a path
    // that skips the access-check block entirely. See the next test.
    const s = src()
    const gate = s.slice(s.indexOf('async authorized('), s.indexOf('async jwt('))
    expect(gate.indexOf('orgHasProductAccess')).toBeLessThan(gate.indexOf('ONBOARDING_PATH'))
  })

  it('never sends an access-exempt path to onboarding, which would bounce it straight back', async () => {
    // The bug this guards: /start-trial is access-exempt (skips the
    // "has a subscription?" check above), but the onboarding-redirect check
    // used to test its own, separate exemption list (INVITE_PREFIX only) —
    // so a brand-new account, unsubscribed and unonboarded (every brand-new
    // account), hit /start-trial → redirected to /onboarding for being
    // unonboarded → /onboarding is NOT access-exempt, so its own access check
    // redirected straight back to /start-trial → forever. ERR_TOO_MANY_REDIRECTS
    // for every first-time signup, plan-chosen or not.
    //
    // The fix makes the onboarding check reuse isAccessExempt directly rather
    // than keeping a second, independently-maintained exemption list — so a
    // future addition to ACCESS_EXEMPT_PATHS is automatically onboarding-exempt
    // too, instead of needing the same fix applied twice.
    const { isAccessExempt, ACCESS_EXEMPT_PATHS } = await import('@/lib/billing/access')

    const s = src()
    const gate = s.slice(s.indexOf('async authorized('), s.indexOf('async jwt('))
    const onboardingCheck = gate.slice(
      gate.indexOf('pathname !== ONBOARDING_PATH'),
      gate.indexOf('return NextResponse.redirect(new URL(ONBOARDING_PATH'),
    )

    expect(
      onboardingCheck,
      'the onboarding redirect must reuse isAccessExempt, not a separate hand-maintained list',
    ).toContain('isAccessExempt(pathname)')
    expect(
      onboardingCheck,
      'INVITE_PREFIX was the narrower, incomplete exemption that caused the loop — it must not come back',
    ).not.toContain('INVITE_PREFIX')

    // Every current access-exempt path is real ground truth for the guarantee
    // above: each one must actually satisfy isAccessExempt, or the onboarding
    // check's reuse of it would silently fail to exempt that path.
    for (const path of ACCESS_EXEMPT_PATHS) {
      expect(isAccessExempt(path), `${path} is in ACCESS_EXEMPT_PATHS but isAccessExempt(${path}) is false`).toBe(
        true,
      )
    }
  })
})

describe('the signup entry point carries the chosen plan', () => {
  it('pricing CTAs link to sign-in with the plan, not the waitlist', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'components/marketing/pricing-toggle.tsx'),
      'utf-8',
    )
    expect(src).toContain('/login?plan=${plan.id}')
    expect(src, 'a pricing CTA still points at the waitlist').not.toContain('href="#waitlist"')
  })

  it('states plainly that the card is not charged', () => {
    // The single sentence most likely to decide whether someone completes this
    // step, so it belongs on the pricing card and again at Stripe's submit.
    const pricing = fs.readFileSync(
      path.join(process.cwd(), 'components/marketing/pricing-toggle.tsx'),
      'utf-8',
    )
    expect(pricing).toMatch(/[Nn]ot charged/)

    const checkout = fs.readFileSync(path.join(process.cwd(), 'lib/billing/checkout.ts'), 'utf-8')
    expect(checkout).toContain('custom_text')
    expect(checkout).toMatch(/will not be charged/)
  })

  it('only honours a real plan id when routing after sign-in', async () => {
    // This value lands in a redirect target, so an unvalidated one is an open
    // redirect.
    const src = fs.readFileSync(path.join(process.cwd(), 'app/actions/auth.ts'), 'utf-8')
    expect(src).toContain('getPlan(requestedPlan)')
    // The destination moved from /start-trial to /checkout when plan choice
    // moved after auth. What must not change is that the id is validated
    // before it lands in a redirect target.
    expect(src).toContain('/checkout?plan=')
  })

  it('sends an abandoned checkout back to the website, not into the product', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/billing/checkout.ts'), 'utf-8')
    expect(src).toMatch(/CANCEL_PATH\s*=\s*'\/pricing'/)
  })

  it('returns from a completed checkout through the exempt waiting page', async () => {
    // Not straight to /billing: that page is gated, and Stripe redirects the
    // browser independently of delivering the webhook, so the browser can
    // arrive before the subscription row exists. Landing on a gated page in
    // that window would bounce someone who just paid.
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/billing/checkout.ts'), 'utf-8')
    expect(src).toContain('/start-trial?checkout=success')

    const { isAccessExempt } = await mod()
    expect(isAccessExempt('/start-trial')).toBe(true)
  })

  it('waits for the webhook after checkout rather than concluding there is no subscription', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/start-trial/page.tsx'), 'utf-8')
    expect(src).toContain("checkout === 'success'")
    // Retries, and on exhaustion self-refreshes rather than redirecting to
    // pricing — asking someone who just paid to pay again is the worst
    // available response.
    expect(src).toMatch(/POST_CHECKOUT_ATTEMPTS/)
    expect(src).toContain('httpEquiv="refresh"')
    const successBlock = src.slice(src.indexOf("checkout === 'success'"))
    expect(successBlock.slice(0, 1200)).not.toContain("redirect('/pricing")
  })

  it('keeps the chosen plan when an already-signed-in visitor clicks a CTA', () => {
    // Otherwise /login sends them to /dashboard and the gate bounces them,
    // losing the click they just made. The destination moved from
    // /start-trial to /checkout when plan choice moved after auth: that page
    // would only have forwarded here anyway, and it exists for the
    // post-checkout webhook wait rather than as a step on the way in.
    const src = fs.readFileSync(path.join(process.cwd(), 'app/login/page.tsx'), 'utf-8')
    expect(src).toContain('/checkout?plan=')
  })

  it('explains itself when it sends someone back to pricing', () => {
    // Landing on a plain pricing page mid-flow reads as lost progress.
    const src = fs.readFileSync(path.join(process.cwd(), 'app/pricing/page.tsx'), 'utf-8')
    expect(src).toMatch(/resume\s*===\s*'1'/)
    expect(src).toMatch(/checkout\s*===\s*'failed'/)
  })
})
