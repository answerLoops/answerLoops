import { NextResponse } from 'next/server'
import { marketingSiteEnabled, MARKETING_URL } from '@/lib/site'

export const dynamic = 'force-dynamic'

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

// Content Signals (https://contentsignals.org, co-authored by Cloudflare)
// separates crawl access from reuse permission: a bot can already be allowed
// to fetch a page via Allow/Disallow above while this states what it may do
// with what it fetches. search/ai-input cover indexing and live retrieval —
// the paths that get answerLoops cited in an AI answer, which is the whole
// point of the site's SEO/crawlability push. ai-train covers using the
// content to train a model, which is a separate grant this project has not
// made and does not need to in order to be cited.
const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=no'

// Next's app/robots.ts metadata convention only serializes a fixed set of
// fields (userAgent/allow/disallow/crawlDelay/sitemap/host) — there is no
// hook for an arbitrary directive like Content-Signal, so this is a plain
// route handler emitting the file text directly instead.
function buildRobotsTxt(): string {
  // A self-hosted install serves the same image we do, so without this it
  // invites crawlers to index its copy of our landing page, pricing page and
  // comparison pages under a domain we do not control — and hands them a
  // sitemap pointing at ours. Nothing on a self-hosted instance is ours to
  // have indexed, so the whole origin is disallowed and no sitemap is offered.
  if (!marketingSiteEnabled()) {
    return 'User-agent: *\nDisallow: /\n'
  }

  const lines = [
    'User-agent: *',
    'Allow: /',
    ...APP_ROUTES.map((route) => `Disallow: ${route}`),
    `Content-Signal: ${CONTENT_SIGNAL}`,
    '',
    `Sitemap: ${MARKETING_URL}/sitemap.xml`,
  ]
  return `${lines.join('\n')}\n`
}

export async function GET() {
  return new NextResponse(buildRobotsTxt(), {
    headers: { 'Content-Type': 'text/plain' },
  })
}
