import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";
import docsNav from "./docs/docs.json" with { type: "json" };
import { MARKETING_PAGE_PATHS } from "./lib/marketing/website-paths";

// Headers applied to every route except the embeddable widget — see below.
const frameBlockingHeaders = [
  // Block clickjacking — page cannot be embedded in any iframe
  { key: 'X-Frame-Options', value: 'DENY' },
  // Belt-and-suspenders CSP frame protection (overrides X-Frame-Options in modern browsers)
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
]

const baseSecurityHeaders = [
  // Prevent MIME-type sniffing — browser must honour declared Content-Type
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't send full referrer to third-party origins
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable browser features this app never uses
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  // Force HTTPS for 2 years once visited over HTTPS (prod only — ignored over HTTP)
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const securityHeaders = [...frameBlockingHeaders, ...baseSecurityHeaders]

// Every page id that used to live in docs.json's nav tree (Mintlify served
// each at `docs.answerloops.com/<id>`). We now serve the same content at
// `/docs/<id>` inside this app, so every old URL needs a redirect or the
// migration breaks inbound links, SEO, and public/llms.txt references —
// see issue #197. Built from the nav tree itself rather than hand-typed so
// it can never drift from the actual page inventory.
function collectDocPageIds(nav: typeof docsNav): string[] {
  const ids: string[] = [];
  for (const group of nav.navigation.groups) {
    for (const page of group.pages) {
      ids.push(page);
    }
  }
  return ids;
}

// The hand-written API reference page was replaced by a generated,
// multi-page Agent API reference (see scripts/generate-api-reference.mjs);
// its old single-page slug now resolves to the new section's overview page.
// The self-hosting Stripe page was dropped outright (internal-ops setup
// detail, not relevant to self-hosters running their own instance) — its
// old URL falls back to the general env-vars page rather than 404ing.
const LEGACY_SLUG_OVERRIDES: Record<string, string> = {
  'reference/api-endpoints': 'reference/api/overview',
  'self-hosting/stripe': 'self-hosting/environment-variables',
};

const legacyDocPageIds = collectDocPageIds(docsNav);

const withMDX = createMDX();

const nextConfig: NextConfig = {
  async headers() {
    return [
      // Everything except /widget/* keeps the frame-blocking headers.
      {
        source: '/((?!widget/).*)',
        headers: securityHeaders,
      },
      // /widget/[widgetToken] exists solely to be iframed — by public/widget.js
      // on this site and on every customer site that embeds the snippet. The
      // global X-Frame-Options: DENY and frame-ancestors 'none' made that
      // impossible: the bubble opened onto a blank panel because the browser
      // refused to render the frame. This route therefore opts out of frame
      // blocking while keeping every other security header.
      //
      // Being embeddable from any origin is the product requirement, not an
      // oversight — a customer embeds this on their own domain. The route
      // renders only a chat UI scoped to the org resolved from the widget
      // token; it exposes no session, no dashboard, and no authenticated
      // action, so there is nothing for a clickjacking frame to hijack.
      {
        source: '/widget/:token',
        headers: baseSecurityHeaders,
      },
      // Next.js content-hashes every file under _next/static — the filename
      // changes whenever the content does, so caching it forever is safe.
      // Without this, Cloudflare has nothing cacheable to work with and
      // every JS/CSS chunk round-trips to the origin on every request.
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Static marketing + docs pages. These carry no per-visitor content (the
      // header CTA is a client island that calls /api/nav-state after
      // hydration), and the auth proxy is scoped off them in proxy.ts so no
      // session cookie is set — so Cloudflare can hold them at the edge and
      // revalidate in the background. Kept off /pricing, which stays dynamic
      // for its resume-flow redirect. `max-age=0` keeps browsers revalidating
      // while `s-maxage` lets the shared cache serve hits.
      {
        source: '/(agentic-support|privacy|terms)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/vs/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/docs/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
    ]
  },
  async redirects() {
    return [
      // Old Mintlify root ("what is answerLoops") lived at the docs
      // subdomain's `/`. Fumadocs serves the same content at `/docs`.
      {
        source: '/',
        has: [{ type: 'host', value: 'docs.answerloops.com' }],
        destination: '/docs/introduction',
        permanent: true,
      },
      // Railway's Custom Domain only lets one hostname bind per port, and
      // app.answerloops.com is bound to :3000 alongside the marketing site.
      // Land visitors straight on the dashboard instead of the marketing
      // homepage when they hit the app subdomain's root.
      {
        source: '/',
        has: [{ type: 'host', value: 'app.answerloops.com' }],
        destination: '/dashboard',
        permanent: true,
      },
      ...legacyDocPageIds.map((id) => ({
        source: `/${id}`,
        has: [{ type: 'host' as const, value: 'docs.answerloops.com' }],
        destination: `/docs/${LEGACY_SLUG_OVERRIDES[id] ?? id}`,
        permanent: true,
      })),
      // Every marketing page is reachable on the app subdomain too — Railway's
      // one-hostname-per-port Custom Domain plan means both hosts share this
      // one deployment, so nothing stops app.answerloops.com/pricing from
      // rendering. Left alone, that duplicates every marketing page onto a
      // second indexable host and confuses anything trying to answer "what
      // does this product do" from the app URL. Send each one back to its
      // canonical home on the root marketing domain — exact path and any
      // nested path underneath it (e.g. /docs/introduction, /vs/chatbase).
      ...MARKETING_PAGE_PATHS.flatMap((path) => [
        {
          source: path,
          has: [{ type: 'host' as const, value: 'app.answerloops.com' }],
          destination: `https://answerloops.com${path}`,
          permanent: true,
        },
        {
          source: `${path}/:rest*`,
          has: [{ type: 'host' as const, value: 'app.answerloops.com' }],
          destination: `https://answerloops.com${path}/:rest*`,
          permanent: true,
        },
      ]),
    ]
  },
}

export default withMDX(nextConfig);
