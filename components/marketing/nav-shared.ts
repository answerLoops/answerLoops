// Shared, component-free constants for the marketing header CTA, split out so
// the server `Nav` shell (chrome.tsx) and the client `NavCta` island
// (nav-cta.tsx) can both import them without a server/client import cycle.

export type NavState = 'anonymous' | 'no-plan' | 'active'

export function navState(loggedIn: boolean, hasAccess: boolean): NavState {
  if (!loggedIn) return 'anonymous'
  return hasAccess ? 'active' : 'no-plan'
}

// Returning users land on the sign-in copy rather than "Create your account".
// Google is the only provider, so both modes run the same OAuth flow — what
// differs is what the page claims to be.
export const SIGNIN_HREF = '/login?mode=signin'

// Every "start" action lands here; the plan is chosen after signing in, on the
// same screen that takes the card.
export const START_HREF = '/login'

// Keep the trial and sign-in labels consistent across desktop and mobile.
export const START_LABEL = 'Start trial'
export const SIGNIN_LABEL = 'Sign in'

// A signed-in visitor with no plan is already past auth, so their journey
// resumes one step further along: straight to the combined plan-and-card page.
export const CHECKOUT_HREF = '/checkout'

// NEXT_PUBLIC_APP_URL is inlined at build time — correct here, since this is a
// client-readable value and cloud sets it before the build.
export const DASHBOARD_HREF = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`
  : '/dashboard'

export const CTA_CLASS =
  'inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 sm:px-4'
export const SECONDARY_CTA_CLASS =
  'hidden min-h-10 items-center whitespace-nowrap px-3 py-2 text-sm font-medium text-slate-600 hover:text-blue-700 sm:inline-flex'
