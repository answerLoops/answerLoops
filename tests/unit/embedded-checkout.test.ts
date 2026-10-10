import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The branded checkout page, and the session behind it.
 *
 * Signup now ends on our own page instead of checkout.stripe.com. The card
 * form is still Stripe's — rendered in an iframe — so this does not take on
 * PCI scope or re-implement payment-method UI. What it does take on is the
 * plumbing around that frame, and every property below is one where being
 * wrong means charging the wrong amount, charging when nothing should be
 * charged, or handing an unsubscribed org a page it cannot use.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('the embedded session is the hosted one, minus the redirect', () => {
  const src = () => read('lib/billing/checkout.ts')

  it('resolves the price per interval exactly as the hosted flow does', () => {
    // The two must not be able to disagree about what someone is buying.
    const embedded = src().slice(src().indexOf('createEmbeddedCheckoutSession'))
    expect(embedded).toContain('stripePriceFor(plan, interval)')
    expect(embedded).toContain("error: 'No Stripe price for this plan'")
  })

  it('still attaches the trial, so nothing is charged on day one', () => {
    const embedded = src().slice(src().indexOf('createEmbeddedCheckoutSession'))
    expect(embedded).toContain('trial_period_days: TRIAL_DAYS')
  })

  it('carries org and plan in metadata, which is how the webhook names the plan', () => {
    const embedded = src().slice(src().indexOf('createEmbeddedCheckoutSession'))
    // Both levels: the session's own metadata and the subscription's. The
    // webhook reads the subscription's.
    expect(embedded).toContain('metadata: { org_id: String(orgId), plan_id: plan.id }')
    expect(embedded.match(/metadata: \{ org_id/g)?.length).toBe(2)
  })

  it('keeps the promotion-code field, which is the whole reason coupons work', () => {
    const embedded = src().slice(src().indexOf('createEmbeddedCheckoutSession'))
    expect(embedded).toContain('allow_promotion_codes: true')
  })

  it("uses the API version's ui_mode spelling, not the one in most examples", () => {
    // The pinned API version renamed these values. 'embedded' type-errors;
    // 'embedded_page' is correct. Worth pinning in a test because every piece
    // of documentation and every example still shows the old name.
    const embedded = src().slice(src().indexOf('createEmbeddedCheckoutSession'))
    expect(embedded).toContain("ui_mode: 'embedded_page'")
  })

  it('returns through the page that already waits for the webhook', () => {
    // An embedded session does not change the race: Stripe redirects the
    // browser independently of delivering the webhook that writes the
    // subscription row, and the browser often wins.
    const embedded = src().slice(src().indexOf('createEmbeddedCheckoutSession'))
    expect(embedded).toContain('/start-trial?checkout=success')
  })

  it('fails closed when Stripe returns no client secret', () => {
    const embedded = src().slice(src().indexOf('createEmbeddedCheckoutSession'))
    expect(embedded).toContain('if (!checkoutSession.client_secret)')
    expect(embedded).toContain('status: STRIPE_FAILURE_STATUS')
  })
})

describe('the checkout page guards match the ones on /start-trial', () => {
  const src = () => read('app/checkout/page.tsx')

  it('requires a session, and carries the plan and interval through sign-in', () => {
    const s = src()
    expect(s).toContain('if (!session?.user)')
    expect(s).toContain('/login?plan=')
    expect(s).toContain('interval=')
  })

  it('never lets an org that already pays start a second subscription', () => {
    expect(src()).toContain('if (await orgHasProductAccess(orgId)) redirect')
  })

  it('falls back to the recommended plan rather than erroring or bouncing', () => {
    // Arriving with no plan is the normal path: every "start" button goes to
    // auth, and auth lands here. An unrecognised id — a hand-edited URL, or a
    // stale link after a plan rename — resolves the same way. Redirecting
    // someone who is trying to pay back to a page that asks them to start over
    // is the worst available answer at the highest-intent moment.
    const s = src()
    expect(s).toContain('getPlan(requestedPlan)')
    expect(s).toContain('getPlan(HIGHLIGHTED_PLAN_ID)')
    expect(s, 'no plan must not bounce the visitor out of checkout').not.toContain("redirect('/pricing?resume=1')")
  })

  it('narrows the interval rather than trusting the query string', () => {
    // It selects which Stripe price the card is charged against.
    expect(src()).toContain('parseBillingInterval(requestedInterval)')
  })

  it('does not dead-end a self-hosted deployment that reaches it by hand', () => {
    expect(src()).toContain('if (!stripeConfigured()) redirect')
  })

  it('is kept out of search results', () => {
    // A checkout page indexed and served to strangers mid-session is worth
    // one line of metadata to prevent.
    expect(src()).toContain('robots:')
    expect(src()).toContain('index: false')
  })
})

describe('a cloud deployment with no Stripe key fails visibly, not in a loop', () => {
  // The live failure: the access gate answers /dashboard for an org with no
  // subscription by redirecting to /start-trial. Both signup pages answered a
  // missing Stripe key by redirecting to /dashboard. On cloud those two point
  // at each other, so one absent environment variable produced
  // ERR_TOO_MANY_REDIRECTS on the path every paying customer walks.
  //
  // isCloudMisconfigured already existed for this, and its own docblock says
  // callers must surface it loudly rather than fall through to the self-hosted
  // branch. Both callers did exactly that.
  it.each(['app/start-trial/page.tsx', 'app/checkout/page.tsx'])(
    '%s renders the misconfiguration instead of redirecting',
    (file) => {
      const s = read(file)
      expect(s).toContain('isCloudMisconfigured()')
      expect(s).toContain('<BillingMisconfigured />')

      // Order matters as much as presence: the self-hosted /dashboard redirect
      // still exists and is still correct, but it has to come second or it
      // catches the cloud case first and the loop returns.
      expect(
        s.indexOf('isCloudMisconfigured()'),
        'the cloud check must run before the self-hosted redirect',
      ).toBeLessThan(s.indexOf("redirect('/dashboard')"))
    },
  )

  it('still sends a genuinely self-hosted visitor to the dashboard', () => {
    // Self-hosted has unconditional access, so the gate never redirects and
    // /dashboard is a real destination rather than half a loop.
    for (const file of ['app/start-trial/page.tsx', 'app/checkout/page.tsx']) {
      expect(read(file)).toContain("if (!stripeConfigured()) redirect('/dashboard')")
    }
  })
})

describe('the page is reachable by the people it exists for', () => {
  it('is exempt from the subscription gate, like /start-trial', async () => {
    // Someone reaches /checkout precisely because they have no subscription.
    // Gating it on having one makes it unreachable by everyone it is for —
    // and, since the onboarding check reuses this same list, would also loop
    // it against /onboarding.
    const { isAccessExempt } = await import('@/lib/billing/access')
    expect(isAccessExempt('/checkout')).toBe(true)
  })

  it('/start-trial hands off to it instead of to checkout.stripe.com', () => {
    const s = read('app/start-trial/page.tsx')
    expect(s).toContain('redirect(`/checkout?plan=')
    expect(s, 'the hosted redirect is what this replaced').not.toContain('redirect(result.url)')
  })
})

describe('switching plan cannot mount a stale session', () => {
  const src = () => read('components/billing/embedded-checkout-panel.tsx')

  it('remounts the provider on a new client secret rather than re-rendering', () => {
    // Stripe reads the secret once at mount. Without a key change, switching
    // plans would leave the previous plan's session on screen — the customer
    // would be charged for a plan they deselected.
    expect(src()).toContain('key={clientSecret}')
  })

  it('discards an in-flight request when the selection changes again', () => {
    // Two rapid switches can otherwise resolve out of order and mount the
    // session for the plan that was deselected.
    const s = src()
    expect(s).toContain('let cancelled = false')
    expect(s).toContain('cancelled = true')
    expect(s).toContain('if (cancelled) return')
  })

  it('refetches whenever either half of the selection changes', () => {
    expect(src()).toContain('}, [planId, interval])')
  })

  it('shows a disabled state rather than crashing without a publishable key', () => {
    const s = src()
    expect(s).toContain('if (!stripePromise)')
    expect(s).toContain('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')
  })

  it('takes the publishable key from the server instead of reading it at build time', () => {
    // NEXT_PUBLIC_* is substituted when the bundle is built, which breaks this
    // value in two ways that both look like "the variable is set and nothing
    // happened": a deployment that sets it after its last build keeps serving
    // `undefined`, and the published container image is built by CI with no
    // Stripe account, so every self-hoster running that image gets `undefined`
    // permanently with no way to override it. A server component reads the
    // environment per request.
    const panel = src()
    // Assignment, not any mention — the docblock explains why the build-time
    // read is wrong and would otherwise trip a looser pattern.
    expect(panel, 'the client must not read the key from the build-time env').not.toMatch(
      /=\s*process\.env\.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/,
    )
    expect(panel).toContain('publishableKey: string | null')

    // Unprefixed name first. NEXT_PUBLIC_* is substituted at build time in
    // server components too, not only client bundles, so the prefixed name
    // cannot deliver a runtime value however it is read. It stays as a
    // fallback for deployments already using it.
    const page = read('app/checkout/page.tsx')
    expect(page).toContain('process.env.STRIPE_PUBLISHABLE_KEY')
    expect(
      page.indexOf('process.env.STRIPE_PUBLISHABLE_KEY'),
      'the runtime-readable name has to be tried first, or the inlined one wins',
    ).toBeLessThan(page.indexOf('process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'))
  })

  it('refuses a key that is not publishable, instead of failing silently', () => {
    // Found by rendering the page: with a restricted key configured, Stripe.js
    // throws inside a promise it owns. Nothing here catches it, no error state
    // renders, and the payment step is an empty box — indistinguishable from a
    // slow network, on the one page where that matters most. Checking the
    // prefix turns a silent failure into a message naming the variable.
    const s = src()
    expect(s).toContain("startsWith('pk_')")
    expect(s, 'the message has to name the fix, not just report a failure').toMatch(/rk_|restricted/)
  })
})

describe('the publishable key is documented wherever env vars are listed', () => {
  // Not .env.example: that's the self-hosting quick-start template, and
  // billing/Stripe is cloud-platform-only — self-hosted deployments are
  // unmetered with checkout unused, so it's deliberately absent there. These
  // two are the reference docs that cover the cloud deployment too.
  it.each([
    'content/docs/reference/environment-variables.mdx',
    'content/docs/self-hosting/environment-variables.mdx',
  ])('%s names STRIPE_PUBLISHABLE_KEY', (file) => {
    // Anyone relying on this doc without it gets a checkout page with no card
    // form. It has to be the unprefixed name: the prefixed one is baked in
    // when the image is built, so it can never be set by whoever runs it.
    expect(read(file)).toContain('STRIPE_PUBLISHABLE_KEY')
  })
})
