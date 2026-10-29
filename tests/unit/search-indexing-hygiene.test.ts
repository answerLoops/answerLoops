import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

// Search Console findings that are fixed in code: sign-in query variants
// reported as duplicates, and /cdn-cgi/ 404s that Cloudflare creates.

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const ORIGINAL_MODE = process.env.DEPLOYMENT_MODE

beforeEach(() => {
  vi.resetModules()
})

afterAll(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.DEPLOYMENT_MODE
  else process.env.DEPLOYMENT_MODE = ORIGINAL_MODE
})

describe('login page is kept out of the index', () => {
  it('exports a robots directive of noindex', async () => {
    const { metadata } = await import('@/app/login/page')
    expect(metadata.robots).toMatchObject({ index: false })
  })

  it('stays crawlable, because a noindex tag is only read on a page a crawler may fetch', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    const { GET } = await import('@/app/robots.txt/route')
    const text = await (await GET()).text()
    const disallowed = text.split('\n').filter((l) => l.startsWith('Disallow:'))
    expect(disallowed).not.toContain('Disallow: /login')
    expect(disallowed).not.toContain('Disallow: /')
  })
})

describe('robots.txt on the hosted site', () => {
  it('disallows the Cloudflare edge path so its 404s stop being reported', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    const { GET } = await import('@/app/robots.txt/route')
    const text = await (await GET()).text()
    expect(text).toContain('Disallow: /cdn-cgi/')
    expect(text).toContain('Allow: /')
    expect(text).toContain('Sitemap: https://answerloops.com/sitemap.xml')
  })
})

describe('login page legal links', () => {
  it('hands the form the marketing origin only on the hosted deployment', () => {
    const src = fs.readFileSync('app/login/page.tsx', 'utf-8')
    expect(src).toMatch(/legalBaseUrl=\{marketingSiteEnabled\(\) \? MARKETING_URL : ''\}/)
  })
})
