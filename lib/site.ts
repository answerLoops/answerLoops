import { getDeploymentMode } from '@/lib/billing/plans'

/**
 * Canonical public URLs for the project itself.
 *
 * The repository URL lived in three places that drifted apart: the marketing
 * chrome, the docs layout, and the waitlist email. The marketing copy was still
 * pointing at the pre-migration repository, which now redirects to the private
 * archive — so every "view source" link on the site sent people somewhere they
 * could not read. One export, imported everywhere, is what stops that
 * recurring. Markdown and MDX cannot import this, so those files carry the
 * literal URL and a test keeps them honest.
 */
export const GITHUB_URL = 'https://github.com/answerLoops/answerLoops'

export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`

/**
 * The app's own origin, on a deployment that splits the marketing site and
 * the product onto separate subdomains — or null when there is only one
 * domain, which is the default for both self-hosting and a fresh clone.
 *
 * Read from an unprefixed variable at request time rather than
 * NEXT_PUBLIC_APP_URL. Next.js inlines every NEXT_PUBLIC_* reference at build
 * time wherever it textually appears — server code included, not only client
 * bundles — so a value set or changed after the last build would never be
 * seen. The same failure hit NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY; see
 * app/checkout/page.tsx. NEXT_PUBLIC_APP_URL stays as a fallback so a
 * deployment that already set it keeps working, and it remains the name
 * marketing CTAs read client-side, where build-time inlining is correct.
 */
export function appOrigin(): string | null {
  const raw = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/** Canonical origin of the hosted marketing site. */
export const MARKETING_URL = 'https://answerloops.com'

/**
 * Whether this deployment should serve the marketing site at all.
 *
 * One image serves both the hosted product and every self-hosted install, so
 * without this every self-hoster also serves our landing page, pricing page and
 * competitor comparisons from their own domain. That is wrong in three ways:
 * the pages sell a hosted plan to somebody who has already chosen not to buy
 * one; `robots.txt` invites crawlers to index a duplicate of our marketing copy
 * on a domain we do not control; and the sitemap it points them at is ours, not
 * theirs.
 *
 * Keyed to the deployment mode rather than a flag of its own so there is one
 * fewer variable to document, and because the polarity is already right:
 * getDeploymentMode() returns 'self-hosted' whenever DEPLOYMENT_MODE is unset,
 * so a fresh clone with no configuration serves no marketing surface and leaks
 * no sitemap without the operator having to know this exists. Only the managed
 * deployment sets DEPLOYMENT_MODE=cloud, and only it should be selling.
 *
 * Deliberately does not cover /docs or /privacy. Documentation is useful to a
 * self-hoster running the thing, and a privacy policy should stay reachable
 * wherever it is served.
 */
export function marketingSiteEnabled(): boolean {
  return getDeploymentMode() === 'cloud'
}
