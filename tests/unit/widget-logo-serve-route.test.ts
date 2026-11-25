import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/widget/logo/[id]: serves a workspace's own logo, only while its plan
 * includes customization, with a fixed type, caching and a version in the address.
 */

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  getOrgByWidgetSlug: vi.fn(),
  getWidgetLogo: vi.fn(),
  orgHasFeature: vi.fn(),
  rateLimitShared: vi.fn(),
  verifyOriginProxy: vi.fn(),
}))

vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken, getOrgByWidgetSlug: h.getOrgByWidgetSlug }))
vi.mock('@/lib/db/queries/widget-logos', () => ({ getWidgetLogo: h.getWidgetLogo }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: h.verifyOriginProxy }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const TOKEN = 'c3'.repeat(24)
const ETAG = '0123456789abcdef'
const BYTES = Buffer.from([82, 73, 70, 70, 1, 2, 3, 4, 87, 69, 66, 80])

async function get(id: string, query = '', headers: Record<string, string> = {}) {
  const { GET } = await import('@/app/api/widget/logo/[id]/route')
  return GET(new Request(`https://app.test/api/widget/logo/${id}${query}`, { headers }), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  h.verifyOriginProxy.mockReturnValue(null)
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.orgHasFeature.mockResolvedValue(true)
  h.getOrgByWidgetToken.mockResolvedValue({ id: 7, widget_token: TOKEN })
  h.getOrgByWidgetSlug.mockResolvedValue({ id: 8, widget_token: TOKEN })
  h.getWidgetLogo.mockResolvedValue({ contentType: 'image/webp', bytes: BYTES, etag: ETAG })
})

describe('serving the logo', () => {
  it('serves the workspace\'s own logo with a fixed type and no sniffing', async () => {
    const res = await get(TOKEN, `?v=${ETAG}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('etag')).toBe(`"${ETAG}"`)
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true)
  })

  it('looks the image up by the workspace the id resolves to, and no other', async () => {
    await get(TOKEN, `?v=${ETAG}`)
    expect(h.getOrgByWidgetToken).toHaveBeenCalledWith(TOKEN)
    expect(h.getWidgetLogo).toHaveBeenCalledWith(7)
    expect(h.getWidgetLogo).toHaveBeenCalledTimes(1)
  })

  it('resolves a public name the same way', async () => {
    await get('acme-support', `?v=${ETAG}`)
    expect(h.getOrgByWidgetSlug).toHaveBeenCalledWith('acme-support')
    expect(h.getWidgetLogo).toHaveBeenCalledWith(8)
  })

  it('treats the version number form of the current version like the fingerprint', async () => {
    const number = String(parseInt(ETAG.slice(0, 10), 16))
    const numeric = (await get(TOKEN, `?v=${number}`)).headers.get('cache-control') ?? ''
    const plain = (await get(TOKEN)).headers.get('cache-control') ?? ''
    expect(numeric).toContain('max-age=3600')
    expect(numeric).not.toBe(plain)
    expect((await get(TOKEN, '?v=1')).headers.get('cache-control')).toBe(plain)
    expect((await get(TOKEN, `?v=${number}9999999`)).headers.get('cache-control')).toBe(plain)
  })

  it('keeps a request for the current version for longer than one without', async () => {
    const versioned = (await get(TOKEN, `?v=${ETAG}`)).headers.get('cache-control') ?? ''
    const plain = (await get(TOKEN)).headers.get('cache-control') ?? ''
    const stale = (await get(TOKEN, '?v=ffffffffffffffff')).headers.get('cache-control') ?? ''
    expect(versioned).toContain('public')
    expect(versioned).toContain('max-age=3600')
    expect(plain).toContain('max-age=60')
    expect(stale).toBe(plain)
    expect(versioned).not.toContain('immutable')
  })

  it('answers 304 when the visitor already has this version', async () => {
    const res = await get(TOKEN, `?v=${ETAG}`, { 'if-none-match': `"${ETAG}"` })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
    expect(res.headers.get('etag')).toBe(`"${ETAG}"`)
    expect(res.headers.get('cache-control')).toContain('public')
  })

  it('does not answer 304 for a different version', async () => {
    expect((await get(TOKEN, '', { 'if-none-match': '"ffffffffffffffff"' })).status).toBe(200)
  })

  it('accepts a weak validator and a list of them', async () => {
    expect((await get(TOKEN, '', { 'if-none-match': `"aaaaaaaaaaaaaaaa", W/"${ETAG}"` })).status).toBe(304)
  })
})

describe('when there is nothing to show', () => {
  it.each([
    ['an id that is neither a token nor a name', 'NOT VALID!!'],
    ['a path-like id', '..%2F..%2Fetc'],
    ['an id that is too short', 'ab'],
    ['an id with capitals', 'ACME'],
  ])('answers 404 for %s without touching the database', async (_label, id) => {
    const res = await get(id)
    expect(res.status).toBe(404)
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
    expect(h.getOrgByWidgetSlug).not.toHaveBeenCalled()
    expect(h.getWidgetLogo).not.toHaveBeenCalled()
    expect(h.rateLimitShared).not.toHaveBeenCalled()
  })

  it('answers 404 for a workspace that does not exist or has an expired token', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(null)
    expect((await get(TOKEN)).status).toBe(404)
    expect(h.getWidgetLogo).not.toHaveBeenCalled()
  })

  it('answers 404 when the workspace has no logo', async () => {
    h.getWidgetLogo.mockResolvedValue(null)
    expect((await get(TOKEN)).status).toBe(404)
  })

  it('answers 404 when the plan no longer includes customization, and never reads the image', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const res = await get(TOKEN, `?v=${ETAG}`)
    expect(res.status).toBe(404)
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'white_label_widget')
    expect(h.getWidgetLogo).not.toHaveBeenCalled()
  })

  it('says nothing about the image in a 404', async () => {
    h.getWidgetLogo.mockResolvedValue(null)
    const res = await get(TOKEN)
    expect(res.headers.get('content-type')).not.toBe('image/webp')
    expect(await res.text()).toBe('Not found')
  })
})

describe('limits and failures', () => {
  it('answers 429, uncached, when a caller asks too often', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false, retryAfterMs: 5000 })
    const res = await get(TOKEN)
    expect(res.status).toBe(429)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(h.getWidgetLogo).not.toHaveBeenCalled()
  })

  it('passes along a refusal from the origin check', async () => {
    h.verifyOriginProxy.mockReturnValue(new Response('no', { status: 403 }))
    expect((await get(TOKEN)).status).toBe(403)
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
  })

  it('answers 503, uncached and without detail, when the lookup fails', async () => {
    h.getWidgetLogo.mockRejectedValue(new Error('connection refused to 10.0.0.5:5432'))
    const res = await get(TOKEN)
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).not.toContain('10.0.0.5')
  })
})
