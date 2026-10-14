import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { parseBillingInterval } from '@/lib/billing/plans'
import { parsePromoCode } from '@/lib/billing/promo'
import { LoginForm } from '@/components/auth/login-form'
import { configuredSignInProviders } from '@/lib/auth/providers'
import { IntegrationIcon } from '@/components/marketing/integration-icon'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'
import { Logo } from '@/components/logo'
import { TRIAL_DAYS } from '@/lib/billing/plans'

export const dynamic = 'force-dynamic'

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: 'Could not start sign-in. Try again.',
  OAuthCallback: 'Sign-in was cancelled or failed. Try again.',
  OAuthCreateAccount: 'Could not create account. Try again.',
  OAuthAccountNotLinked: 'This email is already linked to another provider.',
  Callback: 'Sign-in callback failed. Try again.',
  AccessDenied:
    'We could not sign you in with this account. Try again or contact hello@answerloops.com for help.',
  Default: 'Something went wrong. Try again.',
}

interface Props {
  searchParams: Promise<{
    error?: string
    callbackUrl?: string
    plan?: string
    interval?: string
    code?: string
    mode?: string
  }>
}

export default async function LoginPage({ searchParams }: Props) {
  const { error, plan, interval, code, callbackUrl, mode } = await searchParams
  const promoCode = parsePromoCode(code)

  if (await auth()) {
    // An already-signed-in visitor clicking a pricing CTA lands here with a
    // plan. Sending them to /dashboard would drop the choice and then bounce
    // them off the access gate, losing the click.
    //
    // Straight to /checkout rather than via /start-trial: that page would only
    // forward here anyway, and it exists for the post-checkout webhook wait
    // rather than as a step on the way in.
    //
    // The billing period travels with the plan. /checkout defaults to monthly
    // when it is missing, so dropping it here would charge the monthly price
    // to somebody who clicked an annual card.
    const parsed = parseBillingInterval(interval)
    const codeParam = promoCode ? `code=${encodeURIComponent(promoCode)}` : ''
    const resume = plan
      ? `/checkout?plan=${encodeURIComponent(plan)}${
          parsed ? `&interval=${parsed}` : ''
        }${codeParam ? `&${codeParam}` : ''}`
      : codeParam
        ? `/checkout?${codeParam}`
        : '/dashboard'
    redirect(resume)
  }
  const errorMessage = error
    ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default
    : null

  // Sign-up is the default because that is who arrives here cold. Every
  // sign-in method is OAuth, so both modes run the identical flow — the
  // provider creates or reuses the account either way. What differs is what the page
  // claims to be, and a returning user told only "create an account" reasonably
  // wonders whether they are about to make a second one.
  const signingIn = mode === 'signin'

  // The plan, interval and callbackUrl are the whole reason this page can send
  // someone into checkout instead of dropping them at pricing. Toggling between
  // the two modes must not quietly discard them.
  const carried = new URLSearchParams()
  if (plan) carried.set('plan', plan)
  if (interval) carried.set('interval', interval)
  if (promoCode) carried.set('code', promoCode)
  if (callbackUrl) carried.set('callbackUrl', callbackUrl)
  const toggleParams = new URLSearchParams(carried)
  if (!signingIn) toggleParams.set('mode', 'signin')
  const toggleHref = `/login${toggleParams.size ? `?${toggleParams}` : ''}`

  const providers = configuredSignInProviders()

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      <header className="mx-auto flex max-w-6xl items-center px-4 py-5 sm:px-8">
        <Link href="/" aria-label="answerLoops home">
          <Logo width={104} />
        </Link>
      </header>

      <main className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-4 sm:px-8 lg:min-h-[calc(100vh-8rem)] lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-20 lg:pt-0">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] sm:px-8 sm:py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            {signingIn ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {signingIn
              ? 'Sign in to your workspace.'
              : `Start your ${TRIAL_DAYS}-day trial. No charge today.`}
          </p>

          {errorMessage && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          <div className="mt-6">
            <LoginForm providers={providers} signingIn={signingIn} />
          </div>

          <p className="mt-6 text-sm text-slate-500">
            {signingIn ? "Don't have an account? " : 'Already have an account? '}
            <Link
              href={toggleHref}
              className="font-medium text-slate-950 underline underline-offset-2"
            >
              {signingIn ? 'Create one' : 'Sign in'}
            </Link>
          </p>
        </div>

        <section aria-label="About answerLoops" className="max-w-xl">
          <h2 className="text-3xl font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-4xl lg:text-5xl">
            AI community support from your docs.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            answerLoops turns your docs into answers wherever your community asks. One AI
            drafts the reply and a second checks it against your docs before it goes out.
          </p>
          <div className="mt-8">
            <p className="text-sm font-medium text-slate-900">
              answerLoops supports your community on:
            </p>
            <ul
              className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-3"
              aria-label="Supported channels"
            >
              {MARKETED_CHANNELS.map(({ name, color }) => (
                <li key={name} className="flex items-center gap-2.5 text-sm text-slate-700">
                  <IntegrationIcon name={name} color={color} />
                  {name}
                </li>
              ))}
            </ul>
          </div>
          <ul className="mt-8 space-y-2.5 text-sm text-slate-700">
            {[
              `${TRIAL_DAYS}-day free trial`,
              'Bring your own AI provider key, with no usage markup',
              'Cancel any time from Settings',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[0.5625rem] text-emerald-700">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}
