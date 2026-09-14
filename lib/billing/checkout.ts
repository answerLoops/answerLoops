import Stripe from 'stripe'
import { getStripe } from './stripe'
import { getPlan, stripePriceFor, TRIAL_DAYS, type BillingInterval, type Plan } from './plans'
import { getSubscription } from '@/lib/db/queries/billing'
import { getDb } from '@/lib/db/drizzle'
import { users, memberships } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const MOD = 'billing/checkout'

/**
 * Where Stripe sends someone who backs out of checkout.
 *
 * Deliberately the public pricing page rather than anywhere in the product. A
 * card is required to start a trial, so abandoning checkout means no trial was
 * started — and the dashboard is gated on having one (lib/billing/access.ts).
 * Pointing this at /billing would just bounce off that gate, so it goes
 * straight to the page where they can choose again.
 */
const CANCEL_PATH = '/pricing'

// Checkout can be requested more than once while the browser is mounting the
// embedded form, retrying a slow response, or recovering from a lost network
// response. Stripe's idempotency layer makes those requests converge on one
// session for this org/plan/interval combination instead of creating multiple
// subscription-mode sessions that can each become a Customer.
//
// Bucketed to a short window rather than held constant forever — a fixed key
// only needs to survive the few seconds a retry burst takes, but a plain
// `checkout:${orgId}:${planId}:${interval}` string never expires on our side.
// Stripe just replays the exact stored response to the first request that
// ever used that key, for as long as Stripe retains it, which meant every
// later checkout attempt for the same org/plan/interval — a different day, a
// different browser — silently got handed back that original session instead
// of a new one. Once that first session reached a terminal state (expired,
// completed, or abandoned), every subsequent attempt replayed the same dead
// session and failed the same way, with no way to check out again until the
// key aged out. Confirmed directly in the Stripe dashboard: a request logged
// "This is a replay of a previous request" against this exact key format,
// immediately followed by a 410 on that stale session's own confirm
// endpoint. The bucket keeps the original retry-collapsing behavior intact
// (two attempts a few seconds apart still converge) while guaranteeing a
// attempt outside that window gets a real new session.
const IDEMPOTENCY_KEY_WINDOW_MS = 5 * 60_000
function checkoutIdempotencyKey(orgId: number, planId: string, interval: BillingInterval): string {
  const bucket = Math.floor(Date.now() / IDEMPOTENCY_KEY_WINDOW_MS)
  return `checkout:${orgId}:${planId}:${interval}:${bucket}`
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number }

/**
 * An embedded session hands back a client secret instead of a URL: the card
 * form renders inside our own page rather than on checkout.stripe.com, so
 * there is nowhere to send the browser.
 */
export type EmbeddedCheckoutResult =
  | { ok: true; clientSecret: string }
  | { ok: false; error: string; status: number }

function baseUrl(): string {
  return process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
}

/**
 * Creates a Stripe Checkout session for an org starting or changing a plan.
 *
 * Extracted from the API route so the signup path can call it server-side and
 * redirect straight to Stripe, with no client round trip and no intermediate
 * flash of a page the user never asked for.
 */
export async function createCheckoutSession(
  orgId: number,
  planId: string,
  fallbackEmail: string,
  fallbackName: string,
  // Defaults to monthly so every existing caller keeps its behaviour. An
  // unrecognised value never reaches here — parseBillingInterval narrows it at
  // the edge — but the default also means a missing one bills the lower amount
  // rather than the higher.
  interval: BillingInterval = 'monthly',
): Promise<CheckoutResult> {
  const plan: Plan | null = getPlan(planId)
  if (!plan) return { ok: false, error: 'Unknown plan', status: 400 }

  const priceId = stripePriceFor(plan, interval)
  if (!priceId) {
    // Deliberately not falling back to the other interval: charging a different
    // amount than the page displayed is worse than declining to sell.
    return { ok: false, error: 'No Stripe price for this plan', status: 400 }
  }

  // The owner's address is preferred over the acting user's so the Stripe
  // customer stays attached to whoever owns the workspace, not whichever admin
  // happened to click upgrade.
  const db = getDb()
  const [member] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .innerJoin(
      memberships,
      and(
        eq(memberships.userId, users.id),
        eq(memberships.orgId, orgId),
        eq(memberships.role, 'owner'),
      ),
    )
    .limit(1)

  const email = member?.email ?? fallbackEmail
  const name = member?.name ?? fallbackName

  // A Stripe-side failure here (bad API key, a price that doesn't exist in
  // this mode, a transient outage) must never surface as an empty 500 — the
  // client's useUpgrade hook parses every response as JSON, so an empty body
  // throws an unrelated SyntaxError inside a transition and is silently
  // swallowed, leaving a dead page with no indication anything went wrong.
  try {
    const existing = await getSubscription(orgId)
    const customerId = existing?.stripeCustomerId ?? null

    const stripe = getStripe()
    const base = baseUrl()

    const checkoutSession = await stripe.checkout.sessions.create({
      // Do not create a Stripe Customer before checkout. For a first-time
      // signup, customer_email only prefills Checkout; Stripe creates the
      // Customer as part of the completed subscription. Existing subscribers
      // keep using their stored Customer so upgrades remain attached to the
      // same billing record.
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Back through /start-trial rather than straight to /billing. Stripe
      // redirects the browser independently of delivering the webhook that
      // writes the subscription row, and the browser frequently wins, so the
      // landing page has to tolerate the row not existing yet. /start-trial
      // waits for it; /billing does not have to.
      success_url: `${base}/start-trial?checkout=success`,
      cancel_url: `${base}${CANCEL_PATH}`,
      metadata: { org_id: String(orgId), plan_id: plan.id },
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { org_id: String(orgId), plan_id: plan.id },
      },
      allow_promotion_codes: true,
      // Stripe shows the trial dates on its own, but not in words. Saying it
      // plainly at the submit button is the difference between "why does this
      // want my card" and a understood commitment — and it is the single
      // sentence most likely to decide whether someone completes this step.
      custom_text: {
        submit: {
          message: `Your card will not be charged today. The first ${TRIAL_DAYS} days are free, and you can cancel any time before then at no cost.`,
        },
      },
    }, { idempotencyKey: checkoutIdempotencyKey(orgId, plan.id, interval) })

    if (!checkoutSession.url) {
      logger.error('Stripe returned a session with no URL', { module: MOD, orgId, planId: plan.id })
      return { ok: false, error: 'Could not start checkout. Try again.', status: 502 }
    }

    return { ok: true, url: checkoutSession.url }
  } catch (err) {
    logger.error('Stripe checkout session creation failed', {
      module: MOD,
      orgId,
      planId: plan.id,
      error: err,
    })
    const message =
      err instanceof Stripe.errors.StripeError
        ? 'Could not start checkout — billing is misconfigured. Contact support.'
        : 'Could not start checkout. Try again.'
    return { ok: false, error: message, status: 502 }
  }
}

/**
 * Creates an embedded Checkout session, for the branded signup page.
 *
 * Same plan, price, customer and trial resolution as the hosted flow above —
 * deliberately, so the two cannot disagree about what someone is buying. The
 * differences are only where the card form renders and how the browser gets
 * back:
 *
 * - `ui_mode: 'embedded_page'` renders Stripe's form inside our page. Stripe still
 *   owns the card fields, 3D Secure, wallet buttons and the promotion-code
 *   input, so this changes the surroundings without taking on PCI scope or
 *   re-implementing payment-method UI.
 * - `return_url` replaces success_url/cancel_url. It points back at
 *   /start-trial?checkout=success, which is where the wait-for-the-webhook
 *   handling already lives — an embedded session does not change the fact that
 *   Stripe redirects the browser independently of delivering the webhook.
 *
 * There is no cancel_url because there is nothing to cancel out of: the page
 * hosting the form is ours, and someone abandoning it just navigates away.
 */
export async function createEmbeddedCheckoutSession(
  orgId: number,
  planId: string,
  fallbackEmail: string,
  fallbackName: string,
  interval: BillingInterval = 'monthly',
): Promise<EmbeddedCheckoutResult> {
  const plan: Plan | null = getPlan(planId)
  if (!plan) return { ok: false, error: 'Unknown plan', status: 400 }

  const priceId = stripePriceFor(plan, interval)
  if (!priceId) {
    // Same reasoning as the hosted flow: charging a different amount than the
    // page displayed is worse than declining to sell.
    return { ok: false, error: 'No Stripe price for this plan', status: 400 }
  }

  const db = getDb()
  const [member] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .innerJoin(
      memberships,
      and(
        eq(memberships.userId, users.id),
        eq(memberships.orgId, orgId),
        eq(memberships.role, 'owner'),
      ),
    )
    .limit(1)

  const email = member?.email ?? fallbackEmail
  const name = member?.name ?? fallbackName

  try {
    const existing = await getSubscription(orgId)
    const customerId = existing?.stripeCustomerId ?? null

    const stripe = getStripe()
    const base = baseUrl()

    const checkoutSession = await stripe.checkout.sessions.create({
      // A new signup must not become a Stripe Customer merely by opening the
      // payment form. Checkout creates the Customer when the subscription is
      // completed; an existing subscriber keeps the stored Customer ID.
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      mode: 'subscription',
      // 'embedded_page', not 'embedded': the pinned API version
      // (2026-05-27.dahlia, see lib/billing/stripe.ts) renamed the ui_mode
      // values, and most documentation and examples still show the old names.
      ui_mode: 'embedded_page',
      line_items: [{ price: priceId, quantity: 1 }],
      return_url: `${base}/start-trial?checkout=success`,
      metadata: { org_id: String(orgId), plan_id: plan.id },
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { org_id: String(orgId), plan_id: plan.id },
      },
      allow_promotion_codes: true,
    }, { idempotencyKey: checkoutIdempotencyKey(orgId, plan.id, interval) })

    if (!checkoutSession.client_secret) {
      logger.error('Stripe returned an embedded session with no client secret', {
        module: MOD,
        orgId,
        planId: plan.id,
      })
      return { ok: false, error: 'Could not start checkout. Try again.', status: 502 }
    }

    return { ok: true, clientSecret: checkoutSession.client_secret }
  } catch (err) {
    logger.error('Stripe embedded checkout session creation failed', {
      module: MOD,
      orgId,
      planId: plan.id,
      error: err,
    })
    const message =
      err instanceof Stripe.errors.StripeError
        ? 'Could not start checkout — billing is misconfigured. Contact support.'
        : 'Could not start checkout. Try again.'
    return { ok: false, error: message, status: 502 }
  }
}
