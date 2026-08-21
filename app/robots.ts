import type { MetadataRoute } from 'next'
import { marketingSiteEnabled, MARKETING_URL } from '@/lib/site'

// The app routes a crawler can do nothing useful with — every one of them
// redirects to /login for an anonymous request.
const APP_ROUTES = [
  '/dashboard',
  '/settings',
  '/tickets',
  '/kb',
  '/analytics',
  '/leads',
  '/knowledge-gaps',
  '/billing',
  '/simulation',
  '/onboarding',
  '/account-deleted',
  '/api/',
]

export default function robots(): MetadataRoute.Robots {
  // A self-hosted install serves the same image we do, so without this it
  // invites crawlers to index its copy of our landing page, pricing page and
  // comparison pages under a domain we do not control — and hands them a
  // sitemap pointing at ours. Nothing on a self-hosted instance is ours to
  // have indexed, so the whole origin is disallowed and no sitemap is offered.
  if (!marketingSiteEnabled()) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    }
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: APP_ROUTES,
    },
    sitemap: `${MARKETING_URL}/sitemap.xml`,
  }
}
