// Shared, component-free constants for the marketing header CTA, split out so
// the server `Nav` shell (chrome.tsx) and the client `NavCta` island
// (nav-cta.tsx) can both import them without a server/client import cycle.

export type NavState = 'anonymous' | 'no-plan' | 'active'

export function navState(loggedIn: boolean, hasAccess: boolean): NavState {
  if (!loggedIn) return 'anonymous'
  return hasAccess ? 'active' : 'no-plan'
}

// Returning users enter through the shared sign-in campaign link.
export const SIGNIN_HREF = 'https://dub.sh/sign-in-button'

// Public trial buttons share the same campaign entry point.
export const START_HREF = 'https://dub.sh/start-a-trial'

// Keep the trial and sign-in labels consistent across desktop and mobile.
export const START_LABEL = 'Start trial'
export const SIGNIN_LABEL = 'Log in'

// A signed-in visitor with no plan is already past auth, so their journey
// resumes one step further along: straight to the combined plan-and-card page.
export const CHECKOUT_HREF = '/checkout'

// NEXT_PUBLIC_APP_URL is inlined at build time — correct here, since this is a
// client-readable value and cloud sets it before the build.
export const DASHBOARD_HREF = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`
  : '/dashboard'

export const CTA_CLASS =
  'inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg bg-[#082e50] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#184566] sm:px-4'
export const SECONDARY_CTA_CLASS =
  'hidden min-h-10 items-center whitespace-nowrap px-3 py-2 text-sm font-medium text-slate-600 hover:text-blue-700 sm:inline-flex'
