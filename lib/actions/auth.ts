'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { signIn, signOut } from '@/auth'
import { parsePromoCode } from '@/lib/billing/promo'
import { parseSignInProvider } from '@/lib/auth/providers'

async function getCallbackUrl(): Promise<string> {
  const hdrs = await headers()
  const referer = hdrs.get('referer') ?? ''
  try {
    const url = new URL(referer)

    // Starting a trial no longer passes through checkout: a new account gets
    // the card-free trial the moment it is created, so a plan chosen on the
    // pricing page has nothing to buy yet and is not carried forward. A
    // promotion code still is — someone holding one is headed to checkout for
    // it — narrowed to its allowed shape because it lands in the redirect.
    const promoCode = parsePromoCode(url.searchParams.get('code'))
    const codeParam = promoCode ? `code=${encodeURIComponent(promoCode)}` : ''
    if (codeParam) return `/checkout?${codeParam}`

    const cb = url.searchParams.get('callbackUrl')
    // Only allow same-origin relative paths to prevent open-redirect
    if (cb && cb.startsWith('/') && !cb.startsWith('//')) return cb
  } catch {
    // ignore
  }
  // Nowhere in particular: the dashboard. A new account is mid-trial and goes
  // on to onboarding from there; an account whose trial has ended or was
  // already used is sent to /start-trial, then checkout, by the access gate in
  // auth.ts.
  return '/dashboard'
}

/**
 * Starts the OAuth flow for one sign-in method.
 *
 * The provider id comes from a form value, so it is checked against the
 * methods this deployment has configured before anything starts. An id that
 * does not match goes back to the login page with a generic error rather than
 * reaching the auth library.
 *
 * Signing in and signing up are the same action. A new account accepts the
 * terms on the step that follows (lib/actions/terms.ts).
 */
export async function loginWithProvider(providerId: string): Promise<void> {
  const provider = parseSignInProvider(providerId)
  if (!provider) redirect('/login?error=Default')
  await signIn(provider, { redirectTo: await getCallbackUrl() })
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}

// Same as logout(), but lands back on a specific /login?callbackUrl=... instead
// of the bare /login page — used by the invite email-mismatch screen so
// switching Google accounts drops the person straight back on the invite
// they were trying to accept, instead of the generic dashboard login.
export async function logoutAndReturnTo(callbackUrl: string): Promise<void> {
  const target = callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')
    ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : '/login'
  await signOut({ redirectTo: target })
}
