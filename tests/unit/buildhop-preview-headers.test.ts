import { describe, it, expect } from 'vitest'
import nextConfig from '@/next.config'

type HeaderRule = { source: string; headers: { key: string; value: string }[] }

// Minimal Next source matcher: enough for the patterns used in headers()
// (literal paths, regex groups, ':name' and ':name*' params) without pulling
// in a routing dependency.
function matches(source: string, path: string): boolean {
  const pattern = source.replace(/:\w+\*/g, '.*').replace(/:\w+/g, '[^/]+')
  return new RegExp(`^${pattern}$`).test(path)
}

async function rulesFor(path: string): Promise<HeaderRule[]> {
  const rules = (await nextConfig.headers?.()) as HeaderRule[]
  return rules.filter((r) => matches(r.source, path))
}

function header(rules: HeaderRule[], key: string): string[] {
  return rules.flatMap((r) => r.headers.filter((h) => h.key.toLowerCase() === key.toLowerCase()).map((h) => h.value))
}

describe('next.config: BuildHop iframe preview of the homepage', () => {
  it('sends exactly one CSP on / and it allows self + BuildHop as frame ancestors', async () => {
    const csp = header(await rulesFor('/'), 'content-security-policy')
    expect(csp).toHaveLength(1)
    expect(csp[0]).toContain("frame-ancestors 'self' https://buildhop.io https://www.buildhop.io")
    expect(csp[0]).not.toContain("frame-ancestors 'none'")
  })

  it('keeps the resource directives on / unchanged', async () => {
    const [csp] = header(await rulesFor('/'), 'content-security-policy')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain('frame-src https://js.stripe.com')
  })

  it('drops X-Frame-Options on / but keeps the other security headers', async () => {
    const rules = await rulesFor('/')
    expect(header(rules, 'x-frame-options')).toHaveLength(0)
    expect(header(rules, 'x-content-type-options')).toHaveLength(1)
    expect(header(rules, 'strict-transport-security')).toHaveLength(1)
    expect(header(rules, 'cache-control')).toHaveLength(1)
  })

  it.each(['/pricing', '/dashboard', '/login', '/docs/introduction'])(
    'still denies framing on %s',
    async (path) => {
      const rules = await rulesFor(path)
      expect(header(rules, 'x-frame-options')).toEqual(['DENY'])
      const csp = header(rules, 'content-security-policy')
      expect(csp).toHaveLength(1)
      expect(csp[0]).toContain("frame-ancestors 'none'")
      expect(csp[0]).not.toContain('buildhop')
    }
  )
})
