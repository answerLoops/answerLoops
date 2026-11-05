import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Infrastructure guardrails for the public widget display-settings lookup:
 * the proxy matcher must keep it session-free (so it can be cached at the
 * edge) without loosening its siblings, the route must stay free of auth and
 * cookies, the embed script must keep pointing at the right URLs, and the
 * docs must state the same limits the route enforces.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  orgHasFeature: vi.fn(),
  rateLimitShared: vi.fn(),
  verifyOriginProxy: vi.fn(),
}))

vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: h.verifyOriginProxy }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const TOKEN = 'b2'.repeat(24)

describe('proxy.ts matcher and /api/widget/config', () => {
  const matcherMatch = read('proxy.ts').match(/matcher:\s*\[\s*'([^']+)'/)
  if (!matcherMatch) throw new Error('Could not find the matcher string in proxy.ts')
  const matcher = new RegExp(`^${matcherMatch[1].replace(/\\\\/g, '\\')}$`)

  it('does not run the session proxy on the config lookup, so no session cookie is attached', () => {
    expect(matcher.test('/api/widget/config')).toBe(false)
  })

  it('keeps the exclusion prefix-based: the path with a query-free subpath is also unmatched', () => {
    // The exclusion is a plain prefix inside the negative lookahead, so
    // lookalikes that start with the same text are excluded too. Pinned so a
    // change to this behaviour is a deliberate decision.
    expect(matcher.test('/api/widget/config/extra')).toBe(false)
    expect(matcher.test('/api/widget/configuration-x')).toBe(false)
  })

  it.each([
    '/api/widget/chat',
    '/api/widget/lead',
    '/api/widget/lead-signal',
    `/widget/${'ab'.repeat(24)}`,
    '/api/widget',
    '/api/widget/conf',
    '/api/widget/other-config',
    '/api/auth/session',
  ])('still runs the session proxy on %s', (p) => {
    expect(matcher.test(p), `${p} must remain matched`).toBe(true)
  })
})

describe('app/api/widget/config/route.ts source', () => {
  const src = read('app/api/widget/config/route.ts')

  it('exports a GET handler and nothing that mutates', () => {
    expect(src).toMatch(/export\s+async\s+function\s+GET\b/)
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/)
  })

  it('does not import or call the auth/session module', () => {
    expect(src).not.toMatch(/from\s+['"]@\/auth['"]/)
    expect(src).not.toMatch(/\bauth\s*\(/)
    expect(src).not.toMatch(/next-auth/)
    expect(src).not.toMatch(/\bgetSession\b|\bgetServerSession\b/)
  })

  it('does not touch cookies', () => {
    expect(src).not.toMatch(/set-cookie/i)
    expect(src).not.toMatch(/\bcookies\s*\(/)
    expect(src).not.toMatch(/next\/headers/)
  })
})

describe('GET /api/widget/config behavior: no cookies, no workspace identifiers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.verifyOriginProxy.mockReturnValue(null)
    h.rateLimitShared.mockResolvedValue({ ok: true })
    h.orgHasFeature.mockResolvedValue(true)
    h.getOrgByWidgetToken.mockResolvedValue({
      id: 424242,
      name: 'Distinctive Org Name',
      slug: 'distinctive-org-slug',
      widget_token: TOKEN,
      plan_id: 'enterprise',
      widget_allowed_origins: 'allowed.example',
      widget_lead_capture_mode: 'always',
    })
  })

  async function call(id: string) {
    const { GET } = await import('@/app/api/widget/config/route')
    return GET(new Request(`https://app.test/api/widget/config?id=${id}`))
  }

  it.each([
    ['live token', async () => call(TOKEN)],
    ['malformed token', async () => call('nope')],
  ])('sets no cookie and exposes no org fields for a %s', async (_label, run) => {
    const res = await run()
    expect(res.headers.get('set-cookie')).toBeNull()
    const raw = JSON.stringify(await res.json())
    // The only identifier in the body is the widget token the panel loads with.
    for (const secret of ['424242', 'Distinctive Org Name', 'distinctive-org-slug', 'enterprise', 'allowed.example', 'always']) {
      expect(raw).not.toContain(secret)
    }
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['display', 'token'])
  })

  it('sets no cookie on the throttled and failure paths either', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false })
    const throttled = await call(TOKEN)
    expect(throttled.status).toBe(429)
    expect(throttled.headers.get('set-cookie')).toBeNull()

    h.rateLimitShared.mockResolvedValue({ ok: true })
    h.getOrgByWidgetToken.mockRejectedValue(new Error('db down'))
    const failed = await call(TOKEN)
    expect(failed.status).toBe(503)
    expect(failed.headers.get('set-cookie')).toBeNull()
  })
})

describe('public/widget.js wiring', () => {
  const js = read('public/widget.js')

  it('points the iframe at baseUrl + /widget/ + the resolved panel token', () => {
    expect(js).toContain("iframe.src = baseUrl + '/widget/' + panelToken")
    expect(js).toContain('var panelToken = widgetId;')
  })

  it('fetches the config lookup from the same baseUrl with the widget id', () => {
    expect(js).toContain("fetch(baseUrl + '/api/widget/config?id=' + encodeURIComponent(widgetId)")
    // One baseUrl definition feeds both URLs; the lookup must not hardcode a host.
    expect(js.match(/var baseUrl\s*=/g)).toHaveLength(1)
    expect(js).not.toMatch(/fetch\(\s*['"]https?:/)
  })
})

describe('chat-widget docs match the route limits', () => {
  const docs = read('content/docs/product/chat-widget.mdx')
  const route = read('app/api/widget/config/route.ts')
  const constant = (name: string) => {
    const m = route.match(new RegExp(`const ${name} = ([\\d_]+)`))
    if (!m) throw new Error(`Could not find ${name} in the route`)
    return Number(m[1].replace(/_/g, ''))
  }
  const fmt = (n: number) => n.toLocaleString('en-US')

  it('states the per-address and per-widget limits the route enforces', () => {
    const line = docs.split('\n').find((l) => /display-settings lookup/i.test(l))
    expect(line, 'docs must describe the display-settings lookup limits').toBeDefined()
    expect(line).toContain(`**${fmt(constant('IP_MAX'))}/minute per visitor address**`)
    expect(line).toContain(`**${fmt(constant('ID_MAX'))}/minute per widget**`)
  })

  it('route windows are one minute, matching the per-minute wording in the docs', () => {
    expect(constant('IP_WINDOW_MS')).toBe(60_000)
    expect(constant('ID_WINDOW_MS')).toBe(60_000)
  })
})
