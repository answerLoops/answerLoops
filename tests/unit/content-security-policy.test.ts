import { describe, it, expect, vi, afterEach } from 'vitest'
import nextConfig from '@/next.config'

type HeaderRule = { source: string; headers: { key: string; value: string }[] }

async function cspFor(match: (r: HeaderRule) => boolean): Promise<string | undefined> {
  const rules = (await nextConfig.headers?.()) as HeaderRule[]
  const rule = rules.find(match)
  return rule?.headers.find((h) => h.key.toLowerCase() === 'content-security-policy')?.value
}

const catchAll = (r: HeaderRule) =>
  r.headers.some((h) => h.key.toLowerCase() === 'x-frame-options')

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((d) => {
      const [name, ...rest] = d.trim().split(/\s+/)
      return [name, rest.join(' ')] as [string, string]
    })
  )
}

describe('next.config: content security policy on ordinary routes', () => {
  it('restricts resources with default-src and script-src', async () => {
    const csp = directives((await cspFor(catchAll))!)
    expect(csp.get('default-src')).toBe("'self'")
    expect(csp.get('script-src')).toContain("'self'")
  })

  it('keeps the existing frame-ancestors directive exactly', async () => {
    const csp = directives((await cspFor(catchAll))!)
    expect(csp.get('frame-ancestors')).toBe("'none'")
  })

  it('allows Stripe origins that embedded Checkout needs', async () => {
    const csp = directives((await cspFor(catchAll))!)
    expect(csp.get('script-src')).toContain('https://js.stripe.com')
    expect(csp.get('frame-src')).toContain('https://js.stripe.com')
    expect(csp.get('connect-src')).toContain('https://api.stripe.com')
  })

  it('forbids plugins and base-tag injection', async () => {
    const csp = directives((await cspFor(catchAll))!)
    expect(csp.get('object-src')).toBe("'none'")
    expect(csp.get('base-uri')).toBe("'self'")
  })

  it('does not set form-action, which would also block OAuth redirects after a form post', async () => {
    const csp = directives((await cspFor(catchAll))!)
    expect(csp.has('form-action')).toBe(false)
  })

  describe('per environment', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    async function catchAllCsp(env: string) {
      vi.stubEnv('NODE_ENV', env)
      vi.resetModules()
      const cfg = (await import('@/next.config')).default
      const rules = (await cfg.headers?.()) as HeaderRule[]
      return directives(
        rules.find(catchAll)!.headers.find((h) => h.key.toLowerCase() === 'content-security-policy')!.value
      )
    }

    it('does not allow eval or websockets in production', async () => {
      const csp = await catchAllCsp('production')
      expect(csp.get('script-src')).not.toContain('unsafe-eval')
      expect(csp.get('connect-src')).not.toContain('ws:')
    })

    it('allows eval and websockets only in development for hot reload', async () => {
      const csp = await catchAllCsp('development')
      expect(csp.get('script-src')).toContain("'unsafe-eval'")
      expect(csp.get('connect-src')).toContain('ws:')
    })
  })

  it('leaves the embeddable widget route without a CSP so customer sites can frame it', async () => {
    const csp = await cspFor((r) => r.source.startsWith('/widget/'))
    expect(csp).toBeUndefined()
  })
})
