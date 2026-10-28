import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { isKnownRoute } from '@/lib/marketing/known-routes'
import { notFoundResponse } from '@/lib/marketing/not-found-response'

// An anonymous request for a URL nothing serves used to be redirected to the
// app's sign-in page. Search engines read a login page standing in for a
// missing page as a soft 404, so retired and mistyped URLs (the old
// /changelog among them) stayed in Google's "not indexed" report. auth.ts now
// answers such a URL with a real 404. That only works while every real route
// is classified, which is what these tests hold in place.

const root = process.cwd()
const authSrc = fs.readFileSync(path.join(root, 'auth.ts'), 'utf-8')
const publicMatch = authSrc.match(/const PUBLIC_PATHS = \[([\s\S]*?)\]/)
if (!publicMatch) throw new Error('Could not find PUBLIC_PATHS in auth.ts')
const publicPaths = publicMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)

/** Top-level URL segments the app/ tree defines, expanding `(group)` folders. */
function routeSegments(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith('_')) return []
    if (entry.name.startsWith('(')) return routeSegments(path.join(dir, entry.name))
    return [`/${entry.name}`]
  })
}

describe('every route folder under app/ is classified', () => {
  const segments = [...new Set(routeSegments(path.join(root, 'app')))]

  it('finds the route folders', () => {
    expect(segments).toEqual(expect.arrayContaining(['/pricing', '/login', '/dashboard', '/api', '/widget']))
  })

  it.each(segments)('%s is served, so it must not be answered with a 404', (segment) => {
    // /api and the widget are handled by prefix inside isKnownRoute.
    const probe = segment === '/api' ? '/api/x' : segment
    expect(
      isKnownRoute(probe, publicPaths),
      `${segment} has a route folder but is in none of WEBSITE_PATHS, PLATFORM_PATHS or PUBLIC_PATHS — ` +
        'add it to the right list or it will 404 in production',
    ).toBe(true)
  })
})

describe('isKnownRoute', () => {
  it.each([
    '/', '/pricing', '/blog/some-post', '/docs/introduction', '/vs/intercom', '/robots.txt',
    '/login', '/dashboard', '/tickets/42', '/settings/billing', '/invite/abc123', '/checkout',
    '/api/anything', '/widget', '/widget.js', '/.well-known/oauth-protected-resource', '/openapi.json',
  ])('serves %s', (p) => expect(isKnownRoute(p, publicPaths)).toBe(true))

  it.each([
    '/does-not-exist', '/changelog-old', '/blogger', '/pricing-old', '/dashboardx', '/loginx',
    '/wp-login.php', '/admin', '/.env', '/docs-archive',
  ])('has nothing at %s', (p) => expect(isKnownRoute(p, publicPaths)).toBe(false))

  it('matches on a whole path segment, not a string prefix', () => {
    expect(isKnownRoute('/blog', publicPaths)).toBe(true)
    expect(isKnownRoute('/blogger', publicPaths)).toBe(false)
  })
})

describe('auth.ts wiring', () => {
  const gate = authSrc.slice(authSrc.indexOf('async authorized('), authSrc.indexOf('async jwt('))

  it('answers an unknown route before the host redirect and the sign-in redirect', () => {
    const notFound = gate.indexOf('notFoundResponse()')
    expect(notFound).toBeGreaterThan(-1)
    expect(notFound).toBeLessThan(gate.indexOf('appHost &&'))
    expect(notFound).toBeLessThan(gate.indexOf("new URL('/login'"))
  })
})

describe('notFoundResponse', () => {
  it('is a 404 that crawlers are told to drop', async () => {
    const res = notFoundResponse()
    expect(res.status).toBe(404)
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('Page not found')
    expect(body).toContain('name="robots" content="noindex"')
  })

  it('does not redirect or depend on the request host', () => {
    const res = notFoundResponse()
    expect(res.headers.get('location')).toBeNull()
  })
})
