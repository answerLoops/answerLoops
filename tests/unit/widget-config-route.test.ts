import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for app/api/widget/config/route.ts, the public lookup the embed
 * script calls on load. Org lookups, plan checks and the rate limiter are
 * mocked: this suite is about the route's own branching, the caching headers
 * and what leaves the server.
 */

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  getOrgByWidgetSlug: vi.fn(),
  orgHasFeature: vi.fn(),
  getWidgetLogoVersion: vi.fn(),
  rateLimitShared: vi.fn(),
  verifyOriginProxy: vi.fn(),
}))

vi.mock('@/lib/db/queries/widgets', () => ({
  getOrgByWidgetToken: h.getOrgByWidgetToken,
  getOrgByWidgetSlug: h.getOrgByWidgetSlug,
}))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/widget-logos', () => ({
  getWidgetLogoVersion: h.getWidgetLogoVersion,
  getWidgetLogo: vi.fn(async () => null),
  setWidgetLogo: vi.fn(async () => ({ etag: '0123456789abcdef' })),
  deleteWidgetLogo: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: h.verifyOriginProxy }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const TOKEN = 'a1'.repeat(24)
const NEXT_TOKEN = 'b2'.repeat(24)
const DEFAULTS = { windowSize: 'small', bubbleColor: '#2563eb', bubbleIconColor: '#ffffff', logoVersion: null }

const org = (token: string, brandColor: string | null = null) => ({
  id: 7,
  name: 'Acme',
  widget_token: token,
  plan_id: 'pro',
  widget_allowed_origins: 'acme.test',
  widget_lead_capture_mode: 'on-failure',
  widget_appearance: { title: 'Acme Help Desk', welcome: 'Welcome to Acme', brandColor },
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
  h.getOrgByWidgetSlug.mockResolvedValue(org(NEXT_TOKEN))
  h.getWidgetLogoVersion.mockResolvedValue(null)
})

describe('GET /api/widget/config: resolving the id', () => {
  it('resolves a token to itself and returns display settings', async () => {
    const res = await call(TOKEN)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ token: TOKEN, display: DEFAULTS })
    expect(h.getOrgByWidgetToken).toHaveBeenCalledWith(TOKEN)
    expect(h.getOrgByWidgetSlug).not.toHaveBeenCalled()
  })

  it('resolves a slug to the workspace\'s current token', async () => {
    const res = await call('acme-support')
    expect(await res.json()).toEqual({ token: NEXT_TOKEN, display: DEFAULTS })
    expect(h.getOrgByWidgetSlug).toHaveBeenCalledWith('acme-support')
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
  })

  it('follows a rotation: the same slug returns whatever token is current', async () => {
    h.getOrgByWidgetSlug.mockResolvedValueOnce(org(TOKEN)).mockResolvedValueOnce(org(NEXT_TOKEN))
    expect((await (await call('acme-support')).json()).token).toBe(TOKEN)
    expect((await (await call('acme-support')).json()).token).toBe(NEXT_TOKEN)
  })

  it('returns harmless defaults, not an error, for an unknown or expired id', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(null)
    h.getOrgByWidgetSlug.mockResolvedValue(null)
    for (const id of [TOKEN, 'no-such-widget']) {
      const res = await call(id)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ token: null, display: DEFAULTS })
    }
  })

  it('answers a missing or malformed id with defaults, without touching the database or limiter', async () => {
    for (const id of [undefined, '', 'X', 'has space', 'UPPER', "a'; drop table orgs;--", 'z'.repeat(200)]) {
      const res = await call(id)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ token: null, display: DEFAULTS })
    }
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
    expect(h.getOrgByWidgetSlug).not.toHaveBeenCalled()
    expect(h.rateLimitShared).not.toHaveBeenCalled()
  })
})

describe('GET /api/widget/config: what leaves the server', () => {
  it('returns only the token and display settings, nothing about the workspace', async () => {
    const body = await (await call('acme-support')).json()
    expect(Object.keys(body).sort()).toEqual(['display', 'token'])
    expect(Object.keys(body.display).sort()).toEqual(['bubbleColor', 'bubbleIconColor', 'logoVersion', 'windowSize'])
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('Acme')
    expect(raw).not.toContain('acme.test')
    expect(raw).not.toContain('pro')
    // The title and welcome message are read by the chat panel, never by this
    // public lookup.
    expect(raw).not.toContain('Help Desk')
    expect(raw).not.toContain('Welcome to Acme')
  })

  it('is readable from any site, without credentials', async () => {
    const res = await call(TOKEN)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('serves the brand color a workspace on a customization plan chose, with the icon color that reads on it', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(org(TOKEN, '#ffd60a'))
    const display = (await (await call(TOKEN)).json()).display
    expect(display.bubbleColor).toBe('#ffd60a')
    expect(display.bubbleIconColor).toBe('#111827')
    h.getOrgByWidgetToken.mockResolvedValue(org(TOKEN, '#0b1f4d'))
    const dark = (await (await call(TOKEN)).json()).display
    expect(dark.bubbleColor).toBe('#0b1f4d')
    expect(dark.bubbleIconColor).toBe('#ffffff')
  })

  it('gives a workspace without customization the defaults whatever else is stored', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    h.getOrgByWidgetToken.mockResolvedValue(org(TOKEN, '#ffd60a'))
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

  it('caches the harmless default for an unknown id too, so probing it costs nothing', async () => {
    h.getOrgByWidgetSlug.mockResolvedValue(null)
    expect((await call('no-such-widget')).headers.get('cache-control')).toContain('s-maxage=60')
  })
})

describe('GET /api/widget/config: abuse controls', () => {
  it('charges a per-address and a per-id counter on every lookup', async () => {
    await call('acme-support')
    const keys = h.rateLimitShared.mock.calls.map((c) => c[0])
    expect(keys).toContain('widget-config-ip:203.0.113.9')
    expect(keys).toContain('widget-config-id:acme-support')
  })

  it('answers 429 with defaults and never caches it', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false })
    const res = await call(TOKEN)
    expect(res.status).toBe(429)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ token: null, display: DEFAULTS })
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
    expect(await res.json()).toEqual({ token: null, display: DEFAULTS })
  })
})


describe('GET /api/widget/config: the logo', () => {
  const VERSION = '0123456789abcdef'
  const lookup = async (id: string) => {
    const res = await call(id)
    return { res, body: (await res.json()) as { display: Record<string, unknown> } }
  }

  const NUMBER = parseInt(VERSION.slice(0, 10), 16)

  it('hands the launcher the logo\'s version number when the workspace has one on a customization plan', async () => {
    h.getWidgetLogoVersion.mockResolvedValue({ etag: VERSION })
    const { body } = await lookup(TOKEN)
    expect(h.getWidgetLogoVersion).toHaveBeenCalledWith(7)
    expect(body.display.logoVersion).toBe(NUMBER)
    expect(typeof body.display.logoVersion).toBe('number')
  })

  it('gives the same number for a slug snippet, whose token the lookup resolves separately', async () => {
    h.getWidgetLogoVersion.mockResolvedValue({ etag: VERSION })
    const { body } = await lookup('acme-support')
    expect(body.display.logoVersion).toBe(NUMBER)
    expect((body as unknown as { token: string }).token).toBe(NEXT_TOKEN)
  })

  it('gives a different number when the image changes', async () => {
    h.getWidgetLogoVersion.mockResolvedValue({ etag: VERSION })
    const first = (await lookup(TOKEN)).body.display.logoVersion
    h.getWidgetLogoVersion.mockResolvedValue({ etag: 'fedcba9876543210' })
    const second = (await lookup(TOKEN)).body.display.logoVersion
    expect(second).not.toBe(first)
  })

  it('never returns a path or address for the logo, only a number or null', async () => {
    for (const [feature, logo] of [
      [true, { etag: VERSION }],
      [true, null],
      [false, { etag: VERSION }],
    ] as const) {
      h.orgHasFeature.mockResolvedValue(feature)
      h.getWidgetLogoVersion.mockResolvedValue(logo)
      const res = await call(TOKEN)
      const raw = await res.text()
      const { display } = JSON.parse(raw) as { display: Record<string, unknown> }
      expect(display.logoVersion === null || typeof display.logoVersion === 'number').toBe(true)
      expect(Object.keys(display)).not.toContain('logoPath')
      expect(raw).not.toContain('/api/widget/logo')
    }
  })

  it('gives none when the workspace has no logo', async () => {
    const { body } = await lookup(TOKEN)
    expect(body.display.logoVersion).toBeNull()
  })

  it('gives none on a plan without customization, and does not even look for one', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    h.getWidgetLogoVersion.mockResolvedValue({ etag: VERSION })
    const { body } = await lookup(TOKEN)
    expect(body.display.logoVersion).toBeNull()
    expect(h.getWidgetLogoVersion).not.toHaveBeenCalled()
  })

  it('still answers with the default look when the logo lookup fails', async () => {
    h.getWidgetLogoVersion.mockRejectedValue(new Error('db down'))
    const { res, body } = await lookup(TOKEN)
    expect(res.status).toBe(503)
    expect(body.display).toEqual(DEFAULTS)
  })
})
