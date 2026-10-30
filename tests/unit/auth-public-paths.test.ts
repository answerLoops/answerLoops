import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { isWebsitePath } from '@/lib/marketing/website-paths'

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

  const sitemapSrc = fs.readFileSync(path.join(process.cwd(), 'app/sitemap.ts'), 'utf-8')
  const sitemapPaths = [...sitemapSrc.matchAll(/\{ path: '([^']*)'/g)].map((match) => match[1] || '/')

  it('discovers the static sitemap pages', () => {
    expect(sitemapPaths).toEqual(expect.arrayContaining([
      '/', '/circle-ai-answers', '/discourse-ai-answers', '/dual-agent-ai-support',
    ]))
  })

  it.each(sitemapPaths)('sitemap page %s is public and stays on the marketing host', (route) => {
    expect(publicPaths.some((p) => route === p || route.startsWith(`${p}/`)),
      `${route} must render without a session`).toBe(true)
    expect(isWebsitePath(route), `${route} must stay on the marketing host`).toBe(true)
  })

  const selfAuthenticatingRoutes = [
    '/api/email/ingest', // Svix signature / legacy shared-secret header
    '/api/github/webhook', // GitHub HMAC signature
    '/api/telegram/webhook', // per-org bot_secret, X-Telegram-Bot-Api-Secret-Token header
    '/api/circle/webhook', // per-org bot_secret, same mechanism as Telegram
    '/api/discourse/webhook', // per-site HMAC signature
    '/api/widget/chat', // widget token in body
    '/api/billing/webhook', // Stripe signature
    '/api/slack/events', // Slack signing secret
    '/api/google-chat/events', // Google-signed OIDC bearer token
    '/api/mcp', // Bearer API key
    '/api/v1/agent', // Bearer API key (REST twin of the MCP surface)
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

describe('auth.ts PUBLIC_PATHS covers every route the bot calls with BOT_SECRET', () => {
  // The bot process has no session; it authenticates with BOT_SECRET, checked
  // inside the route by isPlatformBotRequest. A route like that which is not
  // in PUBLIC_PATHS is 401'd by the session proxy before its own check runs,
  // so the bot's sweep silently does nothing. Derived from the source tree,
  // so a new bot route can't be added without being covered.
  const authSrc = fs.readFileSync(path.join(process.cwd(), 'auth.ts'), 'utf-8')
  const match = authSrc.match(/const PUBLIC_PATHS = \[([\s\S]*?)\]/)
  if (!match) throw new Error('Could not find PUBLIC_PATHS in auth.ts')
  const publicPaths = match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)

  function routeFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return routeFiles(full)
      return e.name === 'route.ts' ? [full] : []
    })
  }

  const botRoutes = routeFiles(path.join(process.cwd(), 'app/api'))
    .filter((f) => fs.readFileSync(f, 'utf-8').includes('isPlatformBotRequest('))
    .map((f) => '/' + path.relative(path.join(process.cwd(), 'app'), path.dirname(f)).split(path.sep).join('/'))

  it('finds the bot routes it is guarding', () => {
    expect(botRoutes).toEqual(expect.arrayContaining(['/api/kb/sync-jobs/run', '/api/kb/embedding-migration/run', '/api/billing/trial-reminders/run']))
  })

  it.each(botRoutes)('%s is covered by PUBLIC_PATHS', (route) => {
    const covered = publicPaths.some((p) => route === p || route.startsWith(`${p}/`))
    expect(covered, `${route} checks BOT_SECRET itself but the session proxy will 401 the bot first`).toBe(true)
  })
})
