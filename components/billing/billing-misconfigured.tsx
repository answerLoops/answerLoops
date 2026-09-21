import { PRICING_HREF } from '@/components/marketing/nav-shared'
import Link from 'next/link'
import { LogoMark } from '@/components/logo'

/**
 * Shown when this is a cloud deployment with no Stripe key.
 *
 * A page, not a redirect. Both signup pages used to send this case to
 * /dashboard on the reasoning that no billing means self-hosted, where the
 * dashboard is reachable. That reasoning holds only for a genuinely
 * self-hosted deployment: on cloud, the access gate answers /dashboard by
 * redirecting to /start-trial, which lands right back here — an infinite
 * redirect on the one path every paying customer has to walk, produced by a
 * single missing environment variable.
 *
 * Failing visibly costs the same misconfiguration one clear screen instead of
 * a browser error nobody can diagnose from the outside.
 */
export function BillingMisconfigured() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f8fd] px-5">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
        <div className="mb-5 flex justify-center">
          <LogoMark size={32} />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-950">
          Checkout is temporarily unavailable
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-slate-600">
          Nothing has been charged, and your account is fine. This is a configuration problem on our
          side rather than anything to do with your card or your workspace.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          Please try again shortly. If it persists, email{' '}
          <a className="font-medium text-blue-600 hover:underline" href="mailto:support@answerloops.com">
            support@answerloops.com
          </a>{' '}
          and we will sort it out.
        </p>
        <Link
          href={PRICING_HREF}
          className="mt-7 inline-flex rounded-full border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300"
        >
          Back to pricing
        </Link>
      </div>
    </div>
  )
}
