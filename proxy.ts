// Auth.js handles session verification + public-path logic via the `authorized`
// callback in auth.ts. Exporting `auth` directly as the proxy is the v5 pattern.
export { auth as proxy } from '@/auth'

export const config = {
  // Runs on everything except Next internals, static assets, and the static
  // marketing surfaces.
  //
  // Every response the proxy touches gets Auth.js's CSRF + callback-url
  // `Set-Cookie`, which forces `Cache-Control: private` and leaves Cloudflare
  // nothing to cache. The pages excluded here show every visitor the same
  // content and need no session check, so excluding them is what lets them be
  // cached at the edge.
  // `/` and `/pricing` stay matched (they still resolve a session for their own
  // logic); `/api/*`, `/dashboard/*`, the auth pages, and the not-yet-launched
  // intent pages (/architecture, /support-*, /self-*, /mcp-support-agents,
  // /discord-github-support, /open-source-support) all stay matched too.
  //
  // `openapi.json` and `.well-known/*` are excluded for the same reason as
  // robots/sitemap/llms.txt: they are static, crawler- and agent-fetchable
  // documents, and running them through the session proxy on a split-subdomain
  // deployment can redirect them off the domain they're published on and
  // attaches a session cookie that makes them uncacheable.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|opengraph-image|robots\\.txt|sitemap\\.xml|llms\\.txt|llms-full\\.txt|openapi\\.json|\\.well-known|agentic-support|privacy|terms|vs|docs|.*\\.(?:png|svg|ico)$).*)',
  ],
}
