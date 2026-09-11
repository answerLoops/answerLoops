import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Guardrails for the SEO / edge-cacheability work on feat/seo-crawlability.
//
// The marketing + docs surfaces are only cacheable at the edge if THREE things
// stay true together:
//   1. proxy.ts's middleware matcher does NOT run on them (otherwise Auth.js
//      attaches a CSRF/callback `Set-Cookie` that forces `Cache-Control:
//      private` and Cloudflare caches nothing).
//   2. the app/dashboard/api surfaces ARE still matched (they resolve a
//      session for their own logic — silently dropping them would ship a
//      broken auth gate).
//   3. next.config.ts emits the shared-cache `Cache-Control` header for them.
//
// Plus the two new routes: /api/nav-state must stay per-visitor + uncached and
// must be in PUBLIC_PATHS (or a logged-out visitor is 401'd before the handler
// runs and the anonymous CTA breaks), and /llms-full.txt must stay build-time
// static and actually assemble public/llms.txt + content/docs.

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

describe('proxy.ts middleware matcher', () => {
  // Pull the matcher string straight out of proxy.ts — never hardcode a copy,
  // the whole point is to catch an edit that widens or narrows it.
  const proxySrc = read('proxy.ts')
  const matcherMatch = proxySrc.match(/matcher:\s*\[\s*'([^']+)'/)
  if (!matcherMatch) throw new Error('Could not find the matcher string in proxy.ts')

  // The source file stores the regex inside a JS string literal, so a literal
  // backslash shows up as `\\`. Collapse it back before compiling.
  const matcherSource = matcherMatch[1].replace(/\\\\/g, '\\')
  const matcher = new RegExp(`^${matcherSource}$`)

  const mustMatch = [
    '/dashboard',
    '/dashboard/x',
    '/api/auth/session',
    '/pricing',
    '/architecture',
    '/support-workflow',
    '/mcp-support-agents',
  ]

  const mustNotMatch = [
    '/agentic-support',
    '/privacy',
    '/terms',
    '/vs/chatbase',
    '/docs/introduction',
    '/robots.txt',
    '/sitemap.xml',
    '/llms.txt',
    '/llms-full.txt',
    '/opengraph-image',
  ]

  it.each(mustMatch)('still runs the auth proxy on %s', (p) => {
    expect(matcher.test(p), `${p} must be matched by the proxy matcher (auth logic depends on it)`).toBe(true)
  })

  it.each(mustNotMatch)('is scoped OFF the auth proxy for %s', (p) => {
    expect(matcher.test(p), `${p} must NOT be matched by the proxy matcher (or it can't be edge-cached)`).toBe(false)
  })
})

describe('auth.ts path lists', () => {
  const authSrc = read('auth.ts')
  const listFor = (name: string) => {
    const m = authSrc.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`))
    if (!m) throw new Error(`Could not find ${name} in auth.ts`)
    return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  }
  const covers = (list: string[], route: string) => list.some((p) => route === p || route.startsWith(`${p}/`))

  it('lists /api/nav-state in PUBLIC_PATHS so a logged-out visitor is not 401 before the handler', () => {
    expect(covers(listFor('PUBLIC_PATHS'), '/api/nav-state')).toBe(true)
  })

  it('lists /llms-full.txt in PUBLIC_PATHS', () => {
    expect(covers(listFor('PUBLIC_PATHS'), '/llms-full.txt')).toBe(true)
  })

  it('lists /llms-full.txt in WEBSITE_PATHS so it stays on the marketing host', () => {
    const websitePathsSrc = read('lib/marketing/website-paths.ts')
    const m = websitePathsSrc.match(/export const WEBSITE_PATHS = \[([\s\S]*?)\] as const/)
    if (!m) throw new Error('Could not find WEBSITE_PATHS in lib/marketing/website-paths.ts')
    const websitePaths = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    expect(covers(websitePaths, '/llms-full.txt')).toBe(true)
  })
})

describe('app/api/nav-state/route.ts', () => {
  const src = read('app/api/nav-state/route.ts')

  it('is force-dynamic, never force-static', () => {
    expect(src).toMatch(/export const dynamic\s*=\s*'force-dynamic'/)
    expect(src).not.toContain("'force-static'")
  })

  it('sends a Cache-Control that forbids any caching', () => {
    const cc = src.match(/['"]Cache-Control['"]\s*:\s*['"]([^'"]+)['"]/)
    expect(cc, 'no Cache-Control header found in the nav-state route').toBeTruthy()
    expect(cc![1]).toContain('no-store')
  })

  it('delegates to resolveNavState', () => {
    expect(src).toContain('resolveNavState')
  })
})

describe('app/llms-full.txt/route.ts', () => {
  const src = read('app/llms-full.txt/route.ts')

  it('is force-static (assembled at build time)', () => {
    expect(src).toMatch(/export const dynamic\s*=\s*'force-static'/)
  })

  it('reads the curated public/llms.txt summary', () => {
    expect(src).toMatch(/'public',\s*'llms\.txt'|public\/llms\.txt/)
  })

  it('walks content/docs for every mdx/md page', () => {
    expect(src).toMatch(/'content',\s*'docs'|content\/docs/)
    expect(src).toContain('readdir')
    expect(src).toMatch(/\.mdx?|\.mdx.*\.md|endsWith\('\.mdx'\)/)
  })

  it('serves plain text', () => {
    expect(src).toContain('text/plain; charset=utf-8')
  })
})

describe('next.config.ts marketing cache headers', () => {
  const src = read('next.config.ts')
  const CC = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'

  it.each([
    "'/'",
    "'/(agentic-support|privacy|terms)'",
    "'/vs/:path*'",
    "'/docs/:path*'",
  ])('adds a headers() entry with source %s', (source) => {
    expect(src).toContain(`source: ${source}`)
  })

  it('uses the shared-cache Cache-Control value on those entries', () => {
    // At least the vs + docs entries must carry the s-maxage value.
    const occurrences = src.split(CC).length - 1
    expect(occurrences, `expected the marketing Cache-Control value to appear on multiple headers() entries`).toBeGreaterThanOrEqual(4)
  })
})
