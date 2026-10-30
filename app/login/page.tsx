import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { parsePromoCode } from '@/lib/billing/promo'
import { LoginForm } from '@/components/auth/login-form'
import { configuredSignInProviders } from '@/lib/auth/providers'
import { IntegrationIcon } from '@/components/marketing/integration-icon'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'
import { Logo, LogoMark } from '@/components/logo'
import { ORDERED_PLANS, TRIAL_DAYS } from '@/lib/billing/plans'

export const dynamic = 'force-dynamic'

// Sign-in is not a search result. It is reachable under many query strings
// (?code=…&callbackUrl=…&mode=…) that all render the same form, which Search
// Console reports as duplicates with no canonical. noindex keeps every
// variant out; robots.txt must keep allowing /login or the tag is never read.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: 'Could not start sign-in. Try again.',
  OAuthCallback: 'Sign-in was cancelled or failed. Try again.',
  OAuthCreateAccount: 'Could not create account. Try again.',
  OAuthAccountNotLinked: 'This email is already linked to another provider.',
  Callback: 'Sign-in callback failed. Try again.',
  AccessDenied:
    'We could not sign you in with this account. Try again or contact hello@answerloops.com for help.',
  EmailNotVerified:
    'Your Google account has not verified this email address yet. Verify it with Google, then try again.',
  Default: 'Something went wrong. Try again.',
}

interface Props {
  searchParams: Promise<{
    error?: string
    callbackUrl?: string
    code?: string
  }>
}

export default async function LoginPage({ searchParams }: Props) {
  const { error, code, callbackUrl } = await searchParams
  const promoCode = parsePromoCode(code)

  if (await auth()) {
    // Already signed in. Nothing to buy: a new account is mid-trial and the
    // dashboard takes it from here, and the access gate sends an account whose
    // trial is over to checkout. Only a promotion code has somewhere to go.
    const codeParam = promoCode ? `code=${encodeURIComponent(promoCode)}` : ''
    const resume = codeParam ? `/checkout?${codeParam}` : '/dashboard'
    redirect(resume)
  }
  const errorMessage = error
    ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default
    : null

  const providers = configuredSignInProviders()
  const startingPrice = ORDERED_PLANS[0].priceMonthly / 100

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f5f3]">
      <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-3 sm:px-8">
        <Link href="/" aria-label="answerLoops home" className="inline-flex">
          <Logo width={76} />
        </Link>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 pb-8 sm:px-8">
        <div>
          <h1 className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-950 sm:text-4xl">
            Power up your community with everything it takes to scale.
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-600">
            {`Try every feature free for ${TRIAL_DAYS} days. No card, no obligation.`}
          </p>
        </div>

        {/* Both cards share a row and stretch to the same height, so their top
            and bottom edges line up. */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-stretch lg:gap-10">
          <section
            aria-label="What you get with answerLoops"
            className="flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)]"
          >
            <div className="flex items-center gap-4 border-b border-slate-100 px-6 py-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                <LogoMark size={30} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-950">
                  Try answerLoops, every feature included
                </p>
                <p className="text-sm text-slate-500">{TRIAL_DAYS} days free</p>
              </div>
              <p className="ml-auto text-right">
                <span className="block text-2xl font-semibold tracking-tight text-slate-950">$0.00</span>
                <span className="block text-xs text-slate-500">due today</span>
              </p>
            </div>

            <ul className="flex-1 space-y-3 px-6 py-5 text-sm text-slate-700">
              {[
                'One AI drafts, a second checks every reply against your docs',
                'Every channel your community uses, in one place',
                'A knowledge base that builds itself from your docs',
                'MCP server and REST API for your own agents',
                'Included AI usage, or bring your own key with no markup',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[0.5625rem] text-emerald-700">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <div className="border-t border-slate-100 bg-slate-50/70 px-6 py-4">
              <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-500">
                Works wherever your community asks
              </p>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2" aria-label="Supported channels">
                {MARKETED_CHANNELS.map(({ name, color }) => (
                  <li key={name} title={name} className="flex items-center">
                    <IntegrationIcon name={name} color={color} />
                    <span className="sr-only">{name}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="border-t border-slate-100 px-6 py-4 text-xs leading-relaxed text-slate-500">
              When the {TRIAL_DAYS} days end, you choose whether to continue, from ${startingPrice}/month.
              Nothing is charged unless you add a card.
            </p>
          </section>

          {/* First on a phone, so the sign-in button is on screen without scrolling past the summary. */}
          <main className="order-first flex flex-col justify-center rounded-3xl lg:order-none border border-slate-200 bg-white px-6 py-8 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] sm:px-8 sm:py-10">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              Get started or sign in
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {`New here? Your ${TRIAL_DAYS}-day free trial starts automatically, with no card required. Already have an account? You'll go straight back in.`}
            </p>

            {errorMessage && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {errorMessage}
              </div>
            )}

            <div className="mt-6">
              <LoginForm providers={providers} />
            </div>

            <p className="mt-5 text-xs leading-relaxed text-slate-500">
              New accounts accept our Terms of Service and Privacy Policy on the next step.
            </p>
          </main>
        </div>
      </div>
    </div>
  )
}
