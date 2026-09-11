import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { LogoMark } from '@/components/logo'
import { EmbeddedCheckoutPanel } from '@/components/billing/embedded-checkout-panel'
import {
  ORDERED_PLANS,
  TRIAL_DAYS,
  HIGHLIGHTED_PLAN_ID,
  getPlan,
  parseBillingInterval,
  stripeConfigured,
  isCloudMisconfigured,
} from '@/lib/billing/plans'
import { orgHasProductAccess } from '@/lib/billing/access'
import { BillingMisconfigured } from '@/components/billing/billing-misconfigured'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Start your trial — answerLoops',
  robots: { index: false, follow: false },
}

/**
 * The branded checkout page.
 *
 * Replaces the redirect to checkout.stripe.com for the signup path. The card
 * form is still Stripe's, rendered in an iframe by the panel below — what
 * changed is that it now sits inside our own page, next to the plan picker and
 * the questions people actually ask before entering a card, instead of on a
 * page that looks like it belongs to someone else at the moment of highest
 * hesitation.
 *
 * Every guard here mirrors /start-trial, because both are reachable directly
 * and neither can assume the other ran first.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; interval?: string }>
}) {
  const session = await auth()
  const { plan: requestedPlan, interval: requestedInterval } = await searchParams

  if (!session?.user) {
    const resume = requestedPlan
      ? `/login?plan=${encodeURIComponent(requestedPlan)}&interval=${parseBillingInterval(requestedInterval) ?? 'monthly'}`
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

  // Already paying. Sending them back through checkout would create a second
  // subscription for an org that has one.
  if (await orgHasProductAccess(orgId)) redirect('/dashboard')

  // Arriving with no plan is the normal path now, not an error: every "start"
  // button goes to auth, and auth lands here. The plan is chosen on this page,
  // beside the card, because a free trial makes it a small decision and asking
  // for it first cost a step before anyone was invested.
  //
  // An unrecognised id falls back the same way rather than redirecting. It can
  // only come from a hand-edited URL or a stale link after a plan rename, and
  // showing the picker with a sensible default is a better answer than bouncing
  // someone who is trying to pay to a page that asks them to start over.
  //
  // The default is the highlighted plan, matching the card the pricing page
  // marks "Most popular" — the picker is right there, so this is a starting
  // point rather than a commitment.
  const plan = (requestedPlan ? getPlan(requestedPlan) : null) ?? getPlan(HIGHLIGHTED_PLAN_ID) ?? ORDERED_PLANS[0]

  const interval = parseBillingInterval(requestedInterval) ?? 'monthly'

  return (
    <div className="landing-monochrome brand-system min-h-screen bg-[#f5f5f3]">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size={28} />
            <span className="text-base font-semibold tracking-tight text-slate-950">
              answer<span className="text-blue-600">Loops</span>
            </span>
          </Link>
          <Link
            href="/pricing"
            className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            ← Back to pricing
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">
            Start your {TRIAL_DAYS}-day trial.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            A card is required to start, and nothing is charged for {TRIAL_DAYS} days. Cancel any
            time before then and you will not be billed at all.
          </p>
        </div>

        <div className="mt-10 sm:mt-12">
          <EmbeddedCheckoutPanel
            plans={ORDERED_PLANS}
            initialPlanId={plan.id}
            initialInterval={interval}
            // STRIPE_PUBLISHABLE_KEY first, and note the missing NEXT_PUBLIC_
            // prefix — that is the entire point. Next substitutes every
            // NEXT_PUBLIC_* read at build time, in server components too, not
            // only in client bundles. So reading the prefixed name here would
            // still return whatever the build machine had: nothing for the
            // container image CI builds, and a stale value for a deployment
            // that set the variable after its last build. An unprefixed name is
            // read from the real environment on each request, which is what
            // makes this work without a rebuild and makes the published image
            // configurable by whoever runs it.
            //
            // The prefixed name stays as a fallback so existing deployments
            // keep working; it is inlined, with all the caveats above.
            publishableKey={
              process.env.STRIPE_PUBLISHABLE_KEY ??
              process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
              null
            }
          />
        </div>
      </main>
    </div>
  )
}
