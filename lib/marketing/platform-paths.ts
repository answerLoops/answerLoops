/**
 * The product's own pages: sign-in, checkout, onboarding and the whole
 * dashboard. The counterpart to WEBSITE_PATHS in website-paths.ts — together
 * with the API, the widget and the public documents listed in auth.ts's
 * PUBLIC_PATHS, these are every URL this app actually serves.
 *
 * Anything outside all of those is a URL nothing answers to. auth.ts uses that
 * to give it a real 404 instead of the sign-in redirect every other
 * unauthenticated request gets: a crawler that is sent to a login page for a
 * URL that was never a page reads it as a soft 404, and so does anyone
 * following a mistyped or retired link.
 *
 * Keep this in step with the route folders under app/ and app/(dashboard)/.
 * tests/unit/route-classification.test.ts fails when a route folder is in
 * neither list, so a new page cannot be added and then 404 in production.
 *
 * Pure data, no imports — auth.ts runs in the edge proxy.
 */
export const PLATFORM_PATHS = [
  '/login',
  '/onboarding',
  '/accept-terms',
  '/account-deleted',
  '/start-trial',
  '/checkout',
  '/invite',
  '/dashboard',
  '/tickets',
  '/kb',
  '/knowledge-gaps',
  '/leads',
  '/analytics',
  '/integrations',
  '/simulation',
  '/settings',
  '/billing',
  '/faq',
] as const

const startsWithPath = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`)

export function isPlatformPath(pathname: string): boolean {
  return PLATFORM_PATHS.some((p) => startsWithPath(pathname, p))
}
