/**
 * The marketing website — informational pages with nothing behind a login.
 * Everything else (sign-in, checkout, onboarding, the whole dashboard) is the
 * platform and belongs on the app's own subdomain wherever a deployment has
 * configured one (see appOrigin() in lib/site.ts).
 *
 * Shared by two consumers that both need the exact same list, for opposite
 * directions of the same host split:
 * - auth.ts's `isWebsitePath` — a non-website path hit on the root marketing
 *   domain gets pushed onto the app subdomain.
 * - next.config.ts's `redirects()` — a website path hit on the app subdomain
 *   gets pushed back onto the root marketing domain, so marketing content
 *   never ends up living at two indexable hosts. `/` is handled by its own
 *   redirect there (app-subdomain root goes to `/dashboard`, not the
 *   marketing homepage), and the four well-known URIs (robots.txt,
 *   sitemap.xml, llms.txt, llms-full.txt) are deliberately excluded from that
 *   redirect — a crawler fetching `<host>/robots.txt` expects an answer for
 *   *that* host, not a cross-host redirect.
 *
 * Pure data, no imports — safe for next.config.ts to pull in directly at
 * build time without dragging in auth.ts's server-only dependencies
 * (next-auth, drizzle, DB queries).
 */
export const WEBSITE_PATHS = [
  '/',
  '/pricing',
  '/agentic-support',
  '/vs',
  '/alternatives',
  '/about',
  '/blog',
  '/docs',
  '/privacy',
  '/terms',
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/llms-full.txt',
  '/architecture',
  '/discord-github-support',
  '/mcp-support-agents',
  '/open-source-support',
  '/self-hosted-ai-support',
  '/self-hosting-proof',
  '/support-example',
  '/support-workflow',
] as const

export function isWebsitePath(pathname: string): boolean {
  return WEBSITE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * The subset that should redirect a visitor off the app subdomain and onto
 * the root marketing domain — every website path except `/` (its own
 * dedicated `/dashboard` redirect on the app host) and the well-known URIs
 * a crawler expects answered per-host.
 */
const APP_HOST_EXCLUDED_PATHS = new Set(['/', '/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt'])

export const MARKETING_PAGE_PATHS = WEBSITE_PATHS.filter((p) => !APP_HOST_EXCLUDED_PATHS.has(p))
