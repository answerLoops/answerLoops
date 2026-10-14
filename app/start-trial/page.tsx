import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPlan, isCloudMisconfigured, parseBillingInterval, stripeConfigured, TRIAL_DAYS } from '@/lib/billing/plans'
import { orgHasProductAccess } from '@/lib/billing/access'
import { parsePromoCode } from '@/lib/billing/promo'
import { BillingMisconfigured } from '@/components/billing/billing-misconfigured'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { Logo } from '@/components/logo'

const MOD = 'start-trial'

// Stripe delivers the webhook that writes the subscription row independently of
// redirecting the browser here, and the browser often arrives first. Wait a
// beat for it rather than concluding there is no subscription — the alternative
// is bouncing someone who just paid out to the pricing page.
//
// Webhook delivery is normally well under a second, so this almost always
// resolves on the first check and costs nothing.
const POST_CHECKOUT_ATTEMPTS = 4
const POST_CHECKOUT_DELAY_MS = 600

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The single junction between authenticating and being allowed into the
 * product. Every path redirects except the post-checkout wait.
 *
 * Three kinds of visitor arrive:
 *
 * - **Mid-signup**, having picked a plan and just finished OAuth. Sent straight
 *   to Stripe. No interstitial — they already chose, and a "click to continue"
 *   page is only somewhere to abandon.
 *
 * - **Back from a completed checkout** (`?checkout=success`). Waits briefly for
 *   the webhook, then into the product. This is why the page is exempt from the
 *   access gate: at this moment they have paid but the row may not exist yet.
 *
 * - **Turned away by the gate** — abandoned checkout earlier, cancelled, or a
 *   lapsed trial. No plan to resume, so back to the public pricing page to
 *   choose one. Bouncing them into checkout for a plan they never selected
 *   would be presumptuous.
 */
export default async function StartTrialPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; checkout?: string; interval?: string; code?: string }>
}) {
  const session = await auth()
  const { plan: requestedPlan, checkout, interval: requestedInterval, code } = await searchParams
  const codeParam = parsePromoCode(code) ? `&code=${encodeURIComponent(code as string)}` : ''

  // Narrowed here as well as in the sign-in callback: this page is reachable
  // directly, so it cannot assume the value already passed through there.
  const interval = parseBillingInterval(requestedInterval) ?? 'monthly'

  if (!session?.user) {
    // Preserve the plan and the billing period across sign-in so both survive
    // the round trip — losing the interval would silently bill monthly to
    // somebody who picked annual.
    const resume = requestedPlan
      ? `/login?plan=${encodeURIComponent(requestedPlan)}&interval=${interval}${codeParam}`
      : '/login'
    redirect(resume)
  }

  // A cloud deployment with no Stripe key is a misconfiguration, and it must
  // not be answered with a redirect. The access gate sends an org with no
  // subscription here, so bouncing back to /dashboard bounces straight back —
  // an infinite redirect on the signup path, caused by one missing variable.
  if (isCloudMisconfigured()) return <BillingMisconfigured />

  // Genuinely self-hosted: no billing to run, and the gate never sends anyone
  // here because access is unconditional. Reaching it by hand should not
  // dead-end.
  if (!stripeConfigured()) redirect('/dashboard')

  const orgId = session.orgId ?? DEFAULT_ORG_ID

  if (await orgHasProductAccess(orgId)) redirect('/dashboard')

  // Just completed checkout: the money side is done, we are only waiting on our
  // own bookkeeping.
  if (checkout === 'success') {
    for (let i = 0; i < POST_CHECKOUT_ATTEMPTS; i++) {
      await sleep(POST_CHECKOUT_DELAY_MS)
      if (await orgHasProductAccess(orgId)) redirect('/dashboard')
    }

    // Still nothing. Do not send them to pricing — they paid, and asking them to
    // pay again is the worst possible response. Self-refreshing keeps them on a
    // page that will resolve itself the moment the webhook lands.
    logger.warn('checkout completed but no subscription row yet — waiting on webhook', {
      module: MOD,
      orgId,
    })
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <meta httpEquiv="refresh" content="3" />
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface/95 px-8 py-10 text-center shadow-xl">
          <div className="mb-6 flex justify-center">
            <Logo width={120} />
          </div>
          <h1 className="text-base font-semibold text-ink-900">Finishing setup…</h1>
          <p className="mt-2 text-sm text-ink-500">
            Your {TRIAL_DAYS}-day trial has started and your card has not been charged. This page
            will continue on its own in a moment.
          </p>
        </div>
      </div>
    )
  }

  const plan = requestedPlan ? getPlan(requestedPlan) : null

  // No plan chosen, or an unrecognised one. This used to go back out to the
  // pricing page, which asked a visitor who had already signed in to make the
  // plan decision on a marketing page and then travel back. /checkout now
  // preselects a plan and offers the picker beside the card, so the choice
  // happens once, in the place that can act on it.
  if (!plan) redirect('/checkout')

  // On to the branded checkout page rather than creating a hosted session and
  // redirecting to checkout.stripe.com. The session itself is created there,
  // once the page knows which plan is selected — it lets someone switch plan or
  // interval without leaving, and a Checkout Session's line items are fixed at
  // creation, so creating one here would be throwing it away on the first
  // switch.
  redirect(`/checkout?plan=${encodeURIComponent(plan.id)}&interval=${interval}${codeParam}`)
}
