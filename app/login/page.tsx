import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { parseBillingInterval } from '@/lib/billing/plans'
import { LoginForm } from '@/components/login-form'
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
    mode?: string
  }>
}

export default async function LoginPage({ searchParams }: Props) {
  const { error, plan, interval, callbackUrl, mode } = await searchParams

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
    const resume = plan
      ? `/checkout?plan=${encodeURIComponent(plan)}${
          parsed ? `&interval=${parsed}` : ''
        }`
      : '/dashboard'
    redirect(resume)
  }
  const errorMessage = error
    ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default
    : null

  // Sign-up is the default because that is who arrives here cold. Google is the
  // only provider, so both modes run the identical OAuth flow — Google creates
  // or reuses the account on its side either way. What differs is what the page
  // claims to be, and a returning user told only "create an account" reasonably
  // wonders whether they are about to make a second one.
  const signingIn = mode === 'signin'

  // The plan, interval and callbackUrl are the whole reason this page can send
  // someone into checkout instead of dropping them at pricing. Toggling between
  // the two modes must not quietly discard them.
  const carried = new URLSearchParams()
  if (plan) carried.set('plan', plan)
  if (interval) carried.set('interval', interval)
  if (callbackUrl) carried.set('callbackUrl', callbackUrl)
  const toggleParams = new URLSearchParams(carried)
  if (!signingIn) toggleParams.set('mode', 'signin')
  const toggleHref = `/login${toggleParams.size ? `?${toggleParams}` : ''}`

  return (
    <div className="flex min-h-screen items-center justify-center relative overflow-hidden px-4">
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-brand-50 to-brand-100/60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.12),_transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(239,246,255,0.9),_transparent_50%)]" />
      <div className="relative w-full max-w-sm animate-[softRise_0.45s_ease-out]">
        <div className="rounded-2xl border border-border bg-surface/95 backdrop-blur-sm px-8 py-10 shadow-xl shadow-brand-900/5">
          <div className="mb-8 text-center">
            <div className="mb-3 flex justify-center">
              <Link href="/">
                <Logo width={120} />
              </Link>
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">
              {signingIn ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className="mt-1.5 text-sm text-ink-500">
              {signingIn
                ? 'Sign in to your workspace.'
                : `Start your ${TRIAL_DAYS}-day trial. No charge today.`}
            </p>
          </div>

          {errorMessage && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          <LoginForm signingIn={signingIn} />

          <p className="mt-5 text-center text-sm text-ink-500">
            {signingIn
              ? "Don't have an account? "
              : 'Already have an account? '}
            <Link
              href={toggleHref}
              className="font-medium text-brand-600 underline-offset-2 hover:underline"
            >
              {signingIn ? 'Create one' : 'Sign in'}
            </Link>
          </p>

          <p className="mt-6 text-center text-xs text-ink-400">
            By continuing, you agree to our{' '}
            <Link
              href="/terms"
              className="underline underline-offset-2 hover:text-ink-600"
            >
              Terms of Service
            </Link>{' '}
            and acknowledge our{' '}
            <Link
              href="/privacy"
              className="underline underline-offset-2 hover:text-ink-600"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
