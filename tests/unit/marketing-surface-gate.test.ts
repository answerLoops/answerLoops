import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// app/sitemap pulls in the Fumadocs source, which drags .mdx through vite and
// fails to parse under vitest. The docs entries are not what is under test —
// whether the sitemap is emitted at all is.
vi.mock('@/lib/docs/source', () => ({
  docsSource: { getPages: () => [{ url: '/docs/introduction' }] },
}))

/**
 * One image serves the managed deployment and every self-hosted install, so
 * anything the marketing site does, a self-hoster's domain does too unless it
 * is gated.
 *
 * The visible half is cosmetic — a landing page selling a hosted plan to
 * somebody who has already chosen not to buy one. The costly half is not:
 * `robots.txt` shipped `allow: '/'` and a sitemap pointing at answerloops.com,
 * so every publicly reachable self-hosted instance invited crawlers to index a
 * duplicate of our marketing copy under a domain we do not control, and handed
 * them our sitemap while doing it.
 *
 * The polarity of the gate is the part worth protecting. `getDeploymentMode()`
 * returns 'self-hosted' whenever DEPLOYMENT_MODE is unset, so the safe state is
 * the default: a fresh clone with no configuration serves no marketing surface
 * and no sitemap without its operator knowing any of this exists. A future
 * refactor that inverts this — defaulting to "on" and requiring an opt-out —
 * would reintroduce the leak silently and everywhere at once.
 */

const ORIGINAL_MODE = process.env.DEPLOYMENT_MODE

async function fresh<T>(mode: string | undefined, load: () => Promise<T>): Promise<T> {
  if (mode === undefined) delete process.env.DEPLOYMENT_MODE
  else process.env.DEPLOYMENT_MODE = mode
  const { default: mod } = (await load()) as { default: unknown }
  return mod as T
}

beforeEach(() => {
  delete process.env.DEPLOYMENT_MODE
})

afterAll(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.DEPLOYMENT_MODE
  else process.env.DEPLOYMENT_MODE = ORIGINAL_MODE
})

describe('marketingSiteEnabled is off unless this is the managed deployment', () => {
  it('is off when DEPLOYMENT_MODE is unset', async () => {
    delete process.env.DEPLOYMENT_MODE
    const { marketingSiteEnabled } = await import('@/lib/site')
    expect(marketingSiteEnabled(), 'unset must mean off — this is the default a clone gets').toBe(false)
  })

  it('is off for an explicitly self-hosted deployment', async () => {
    process.env.DEPLOYMENT_MODE = 'self-hosted'
    const { marketingSiteEnabled } = await import('@/lib/site')
    expect(marketingSiteEnabled()).toBe(false)
  })

  it('is off for any unrecognised value rather than treating it as opt-in', async () => {
    for (const value of ['Cloud', 'CLOUD', 'production', 'true', '1', '']) {
      process.env.DEPLOYMENT_MODE = value
      const { marketingSiteEnabled } = await import('@/lib/site')
      expect(marketingSiteEnabled(), `${JSON.stringify(value)} must not enable the marketing site`).toBe(false)
    }
  })

  it('is on only for exactly "cloud"', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    const { marketingSiteEnabled } = await import('@/lib/site')
    expect(marketingSiteEnabled()).toBe(true)
  })
})

describe('robots.txt does not invite crawlers onto a self-hosted install', () => {
  it('disallows the whole origin and offers no sitemap when not cloud', async () => {
    const robots = await fresh<() => { rules: unknown; sitemap?: string }>(
      undefined,
      () => import('@/app/robots'),
    )
    const out = robots()

    expect(out.rules).toEqual({ userAgent: '*', disallow: '/' })
    expect(
      out.sitemap,
      'a self-hosted instance must not advertise our sitemap as its own',
    ).toBeUndefined()
  })

  it('allows crawling and points at our sitemap on the managed deployment', async () => {
    const robots = await fresh<() => { rules: { allow?: string; disallow?: string[] }; sitemap?: string }>(
      'cloud',
      () => import('@/app/robots'),
    )
    const out = robots()

    expect(out.rules.allow).toBe('/')
    expect(out.sitemap).toBe('https://answerloops.com/sitemap.xml')
    // The app routes stay excluded — a crawler gets a /login redirect from
    // every one of them.
    expect(out.rules.disallow).toContain('/dashboard')
    expect(out.rules.disallow).toContain('/api/')
  })
})

describe('the sitemap is empty off the managed deployment', () => {
  it('lists nothing when not cloud', async () => {
    const sitemap = await fresh<() => unknown[]>(undefined, () => import('@/app/sitemap'))
    expect(sitemap(), 'every URL in it would be one we do not serve there').toEqual([])
  })

  it('lists the marketing routes on cloud', async () => {
    const sitemap = await fresh<() => { url: string }[]>('cloud', () => import('@/app/sitemap'))
    const urls = sitemap().map((e) => e.url)

    expect(urls).toContain('https://answerloops.com')
    expect(urls).toContain('https://answerloops.com/pricing')
    expect(urls.every((u) => u.startsWith('https://answerloops.com')), 'no foreign origins').toBe(true)
  })
})

describe('the marketing pages themselves are gated', () => {
  const read = async (rel: string) => (await import('node:fs')).readFileSync(rel, 'utf-8')

  it('sends root to the product rather than a sales page when not cloud', async () => {
    // A self-hoster typing the bare host wants the thing they installed. The
    // access gate carries an unauthenticated request on to /login from there.
    const src = await read('app/page.tsx')
    expect(src).toContain("if (!marketingSiteEnabled()) redirect('/dashboard')")
  })

  it('404s the pricing and comparison pages when not cloud', async () => {
    for (const file of ['app/pricing/page.tsx', 'app/vs/chatbase/page.tsx', 'app/vs/intercom/page.tsx']) {
      const src = await read(file)
      expect(src, `${file} must be gated`).toContain('if (!marketingSiteEnabled()) notFound()')
    }
  })

  it('leaves docs and privacy reachable everywhere', async () => {
    // Documentation is useful to whoever is running the thing, and a privacy
    // policy should not vanish because of a deployment flag.
    for (const file of ['app/docs/layout.tsx', 'app/privacy/page.tsx']) {
      const src = await read(file)
      expect(src, `${file} should not be gated`).not.toContain('marketingSiteEnabled')
    }
  })
})
