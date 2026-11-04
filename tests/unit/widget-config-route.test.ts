import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for app/api/widget/config/route.ts, the public lookup the embed
 * script calls on load. Org lookups, plan checks and the rate limiter are
 * mocked: this suite is about the route's own branching, the caching headers
 * and what leaves the server.
 */

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

const TOKEN = 'a1'.repeat(24)
const DEFAULTS = { windowSize: 'small', bubbleColor: '#4f46e5' }

const org = (token: string) => ({
  id: 7,
  name: 'Acme',
  widget_token: token,
  plan_id: 'pro',
  widget_allowed_origins: 'acme.test',
  widget_lead_capture_mode: 'on-failure',
})

async function call(id?: string) {
  const { GET } = await import('@/app/api/widget/config/route')
  const url = new URL('https://app.test/api/widget/config')
  if (id !== undefined) url.searchParams.set('id', id)
  return GET(new Request(url))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.verifyOriginProxy.mockReturnValue(null)
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.orgHasFeature.mockResolvedValue(true)
  h.getOrgByWidgetToken.mockResolvedValue(org(TOKEN))
})

describe('GET /api/widget/config: looking up the widget', () => {
  it('returns display settings for a live widget token', async () => {
    const res = await call(TOKEN)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ display: DEFAULTS })
    expect(h.getOrgByWidgetToken).toHaveBeenCalledWith(TOKEN)
  })

  it('returns harmless defaults, not an error, for an unknown or expired token', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(null)
    const res = await call(TOKEN)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ display: DEFAULTS })
  })

  it('answers a missing or malformed id with defaults, without touching the database or limiter', async () => {
    for (const id of [undefined, '', 'X', 'has space', 'UPPER', "a'; drop table orgs;--", 'z'.repeat(200), 'A1'.repeat(24)]) {
      const res = await call(id)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ display: DEFAULTS })
    }
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
    expect(h.rateLimitShared).not.toHaveBeenCalled()
  })
})

describe('GET /api/widget/config: what leaves the server', () => {
  it('returns only display settings, nothing about the workspace', async () => {
    const body = await (await call(TOKEN)).json()
    expect(Object.keys(body)).toEqual(['display'])
    expect(Object.keys(body.display).sort()).toEqual(['bubbleColor', 'windowSize'])
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('Acme')
    expect(raw).not.toContain('acme.test')
    expect(raw).not.toContain('pro')
    expect(raw).not.toContain(TOKEN)
  })

  it('is readable from any site, without credentials', async () => {
    const res = await call(TOKEN)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('gives a workspace without customization the defaults whatever else is stored', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const res = await call(TOKEN)
    expect((await res.json()).display).toEqual(DEFAULTS)
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'white_label_widget')
  })
})

describe('GET /api/widget/config: caching', () => {
  it('lets browsers and the edge cache a good answer briefly', async () => {
    const cc = (await call(TOKEN)).headers.get('cache-control')
    expect(cc).toContain('public')
    expect(cc).toMatch(/max-age=60/)
    expect(cc).toMatch(/s-maxage=60/)
    expect(cc).toContain('stale-while-revalidate')
  })

  it('caches the harmless default for an unknown token too, so probing it costs nothing', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(null)
    expect((await call(TOKEN)).headers.get('cache-control')).toContain('s-maxage=60')
  })
})

describe('GET /api/widget/config: abuse controls', () => {
  it('charges a per-address and a per-id counter on every lookup', async () => {
    await call(TOKEN)
    const keys = h.rateLimitShared.mock.calls.map((c) => c[0])
    expect(keys).toContain('widget-config-ip:203.0.113.9')
    expect(keys).toContain(`widget-config-id:${TOKEN}`)
  })

  it('answers 429 with defaults and never caches it', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false })
    const res = await call(TOKEN)
    expect(res.status).toBe(429)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ display: DEFAULTS })
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
  })

  it('throttles when either counter trips', async () => {
    h.rateLimitShared.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })
    expect((await call(TOKEN)).status).toBe(429)
  })

  it('returns the origin-guard rejection for a request that bypassed the edge', async () => {
    h.verifyOriginProxy.mockReturnValue(new Response('Forbidden', { status: 403 }))
    expect((await call(TOKEN)).status).toBe(403)
    expect(h.rateLimitShared).not.toHaveBeenCalled()
  })

  it('degrades to uncached defaults when the lookup itself fails', async () => {
    h.getOrgByWidgetToken.mockRejectedValue(new Error('db down'))
    const res = await call(TOKEN)
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ display: DEFAULTS })
  })
})
