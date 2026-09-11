import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Guardrail for a real production bug: every route that authenticates a
// caller by its own means (webhook signature, Bearer API key, shared secret)
// rather than a session cookie must be listed in auth.ts's PUBLIC_PATHS, or
// the session-auth middleware 401s every request before the route's own
// handler — and unlike a normal 401, it fails silently for a webhook, since
// nothing surfaces the rejection to a human. /api/email/ingest shipped
// without ever being added to this list, so the inbound email channel has
// never actually been reachable in production.

describe('auth.ts PUBLIC_PATHS covers every self-authenticating API route', () => {
  const authSrc = fs.readFileSync(path.join(process.cwd(), 'auth.ts'), 'utf-8')
  const match = authSrc.match(/const PUBLIC_PATHS = \[([\s\S]*?)\]/)
  if (!match) throw new Error('Could not find PUBLIC_PATHS in auth.ts')
  const publicPaths = match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)

  const selfAuthenticatingRoutes = [
    '/api/email/ingest', // Svix signature / legacy shared-secret header
    '/api/github/webhook', // GitHub HMAC signature
    '/api/widget/chat', // widget token in body
    '/api/billing/webhook', // Stripe signature
    '/api/slack/events', // Slack signing secret
    '/api/google-chat/events', // Google-signed OIDC bearer token
    '/api/mcp', // Bearer API key
    '/api/agent', // Bearer API key (REST twin of the MCP surface)
  ]

  // Static, crawler-/agent-fetchable documents. Same failure mode as the
  // public page routes below (a split-subdomain deployment 307s them off the
  // domain they're published on), plus the session cookie the proxy attaches
  // makes them uncacheable. They must be both in PUBLIC_PATHS and excluded
  // from the proxy matcher in proxy.ts.
  const publicDocumentRoutes = [
    '/openapi.json',
    '/.well-known/oauth-protected-resource',
    '/.well-known/ai-plugin.json',
  ]

  it.each(publicDocumentRoutes)('%s is listed in (or covered by a prefix in) PUBLIC_PATHS', (route) => {
    const covered = publicPaths.some((p) => route === p || route.startsWith(`${p}/`))
    expect(covered, `${route} is not covered by any PUBLIC_PATHS entry`).toBe(true)
  })

  it('proxy.ts matcher excludes openapi.json and .well-known so the session middleware never runs on them', () => {
    const proxySrc = fs.readFileSync(path.join(process.cwd(), 'proxy.ts'), 'utf-8')
    const matcher = proxySrc.match(/matcher:\s*\[\s*'([^']+)'/)?.[1]
    if (!matcher) throw new Error('Could not find the matcher pattern in proxy.ts')
    // The matcher is one big negative-lookahead alternation; an entry there is
    // a path prefix the middleware skips. These sit alongside llms\.txt etc.
    expect(matcher, 'openapi.json must be in the matcher exclusion list').toMatch(/openapi\\+\.json/)
    expect(matcher, '.well-known must be in the matcher exclusion list').toMatch(/\\+\.well-known/)
  })

  it.each(selfAuthenticatingRoutes)('%s is listed in (or covered by a prefix in) PUBLIC_PATHS', (route) => {
    const covered = publicPaths.some((p) => route === p || route.startsWith(`${p}/`))
    expect(covered, `${route} is not covered by any PUBLIC_PATHS entry — the session-auth middleware will 401 it`).toBe(true)
  })

  // Same root cause, different symptom: unauthenticated *page* routes (no
  // session cookie at all, since visitors aren't logged in) 307-redirect to
  // /login instead of 401ing. /vs/* shipped with this bug before being added
  // here; /pricing repeated it.
  const publicPageRoutes = [
    '/vs', // comparison pages
    '/pricing', // pricing page
    '/privacy', // legal policy must be readable before account creation
    '/terms', // contract terms must be readable before account creation
    // Intent pages listed in sitemap.ts but missing from PUBLIC_PATHS /
    // WEBSITE_PATHS shipped 307ing off the marketing domain to
    // app.answerloops.com/login — every one of them unreachable to Google
    // despite being submitted for indexing.
    '/architecture',
    '/discord-github-support',
    '/mcp-support-agents',
    '/open-source-support',
    '/self-hosted-ai-support',
    '/self-hosting-proof',
    '/support-example',
    '/support-workflow',
  ]

  it.each(publicPageRoutes)('%s is listed in (or covered by a prefix in) PUBLIC_PATHS', (route) => {
    const covered = publicPaths.some((p) => route === p || route.startsWith(`${p}/`))
    expect(covered, `${route} is not covered by any PUBLIC_PATHS entry — unauthenticated visitors get 307'd to /login before the page ever renders`).toBe(true)
  })

  it('keeps public website pages on the marketing host when APP_URL is configured', () => {
    const websitePathsSrc = fs.readFileSync(path.join(process.cwd(), 'lib/marketing/website-paths.ts'), 'utf-8')
    const websiteMatch = websitePathsSrc.match(/export const WEBSITE_PATHS = \[([\s\S]*?)\] as const/)
    if (!websiteMatch) throw new Error('Could not find WEBSITE_PATHS in lib/marketing/website-paths.ts')
    const websitePaths = websiteMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)

    for (const route of publicPageRoutes) {
      const covered = websitePaths.some((p) => route === p || route.startsWith(`${p}/`))
      expect(covered, `${route} is not covered by WEBSITE_PATHS — it will redirect from the marketing host to the app host`).toBe(true)
    }
  })
})
