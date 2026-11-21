import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

/**
 * POST and DELETE /api/settings/widget-logo: who may upload, what is accepted,
 * and that only the small re-encoded image is ever stored.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  orgHasFeature: vi.fn(),
  ensureWidgetToken: vi.fn(),
  setWidgetLogo: vi.fn(),
  deleteWidgetLogo: vi.fn(),
  rateLimitShared: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/widgets', () => ({ ensureWidgetToken: h.ensureWidgetToken }))
vi.mock('@/lib/db/queries/widget-logos', () => ({ setWidgetLogo: h.setWidgetLogo, deleteWidgetLogo: h.deleteWidgetLogo }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const TOKEN = 'c3'.repeat(24)

const png = (w = 300, h2 = 300) =>
  sharp({ create: { width: w, height: h2, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 1 } } }).png().toBuffer()

function uploadRequest(bytes: Uint8Array | string, name = 'logo.png', type = 'image/png', extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set('file', new File([bytes as BlobPart], name, { type }))
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  return new Request('https://app.test/api/settings/widget-logo', { method: 'POST', body: fd })
}

async function post(req: Request) {
  const { POST } = await import('@/app/api/settings/widget-logo/route')
  return POST(req as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, role: 'owner' })
  h.orgHasFeature.mockResolvedValue(true)
  h.ensureWidgetToken.mockResolvedValue({ token: TOKEN, expiresAt: '2036-01-01T00:00:00.000Z' })
  h.setWidgetLogo.mockImplementation(async (_org: number, logo: { etag: string }) => ({ etag: logo.etag }))
  h.deleteWidgetLogo.mockResolvedValue(undefined)
  h.rateLimitShared.mockResolvedValue({ ok: true })
})

describe('POST: a Pro owner or admin', () => {
  it('stores the small re-encoded image and answers with its address', async () => {
    const original = await png(1200, 800)
    const res = await post(uploadRequest(original))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { logoUrl: string }
    expect(body.logoUrl).toMatch(new RegExp(`^/api/widget/logo/${TOKEN}\\?v=[0-9a-f]{16}$`))

    expect(h.setWidgetLogo).toHaveBeenCalledTimes(1)
    const [orgId, logo] = h.setWidgetLogo.mock.calls[0] as [number, { contentType: string; bytes: Buffer; etag: string }]
    expect(orgId).toBe(7)
    expect(logo.contentType).toBe('image/webp')
    expect(logo.bytes.equals(original)).toBe(false)
    const m = await sharp(logo.bytes).metadata()
    expect([m.format, m.width, m.height]).toEqual(['webp', 256, 256])
    expect(body.logoUrl.endsWith(`v=${logo.etag}`)).toBe(true)
  })

  it('lets an admin upload too', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, role: 'admin' })
    expect((await post(uploadRequest(await png()))).status).toBe(200)
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('replaces an earlier logo: a second upload stores again with a new version', async () => {
    const first = (await (await post(uploadRequest(await png(300, 300)))).json()) as { logoUrl: string }
    const other = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 20, b: 20 } } }).png().toBuffer()
    const second = (await (await post(uploadRequest(other))).json()) as { logoUrl: string }
    expect(h.setWidgetLogo).toHaveBeenCalledTimes(2)
    expect(second.logoUrl).not.toBe(first.logoUrl)
  })

  it('uses the signed-in member\'s workspace, whatever the request says', async () => {
    await post(uploadRequest(await png(), 'logo.png', 'image/png', { orgId: '999', org_id: '999', widgetToken: 'x'.repeat(48) }))
    expect(h.setWidgetLogo.mock.calls[0][0]).toBe(7)
    expect(h.ensureWidgetToken).toHaveBeenCalledWith(7)
  })

  it('judges the file by its content: a PNG with a .jpg name and a wrong declared type is accepted as the image it is', async () => {
    expect((await post(uploadRequest(await png(), 'logo.jpg', 'image/jpeg'))).status).toBe(200)
  })
})

describe('POST: who is refused', () => {
  it('refuses someone who is not signed in, before reading anything', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const res = await post(uploadRequest(await png()))
    expect(res.status).toBe(401)
    expect(h.setWidgetLogo).not.toHaveBeenCalled()
    expect(h.orgHasFeature).not.toHaveBeenCalled()
  })

  it('refuses a member who is not an owner or admin', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Forbidden' })
    const res = await post(uploadRequest(await png()))
    expect(res.status).toBe(403)
    expect(h.setWidgetLogo).not.toHaveBeenCalled()
  })

  it('refuses a workspace on a plan without customization, and never reads the file', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const res = await post(uploadRequest(await png()))
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/Pro and above/)
    expect(h.setWidgetLogo).not.toHaveBeenCalled()
    expect(h.rateLimitShared).not.toHaveBeenCalled()
  })

  it('answers 429 when a workspace uploads too often', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false, retryAfterMs: 120_000 })
    const res = await post(uploadRequest(await png()))
    expect(res.status).toBe(429)
    expect(h.setWidgetLogo).not.toHaveBeenCalled()
  })
})

describe('POST: what is refused, with plain messages', () => {
  const body = async (res: Response) => (await res.json()) as { error: string; code?: string }

  it('refuses an SVG', async () => {
    const res = await post(uploadRequest('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'logo.svg', 'image/svg+xml'))
    expect(res.status).toBe(400)
    expect((await body(res)).error).toBe('That file is not a PNG, JPEG or WebP image.')
    expect(h.setWidgetLogo).not.toHaveBeenCalled()
  })

  it('refuses a text file renamed .png', async () => {
    const res = await post(uploadRequest('just some text', 'logo.png', 'image/png'))
    expect(res.status).toBe(400)
    expect((await body(res)).error).toBe('That file is not a PNG, JPEG or WebP image.')
  })

  it('refuses a damaged image', async () => {
    const real = await png(400, 400)
    const res = await post(uploadRequest(real.subarray(0, Math.floor(real.length / 2))))
    expect(res.status).toBe(400)
    expect((await body(res)).error).toBe('We could not read that image.')
  })

  it('refuses a file over 1 MB with 413 and the plain message', async () => {
    const res = await post(uploadRequest(Buffer.concat([await png(), Buffer.alloc(1024 * 1024 + 10)])))
    expect(res.status).toBe(413)
    expect((await body(res)).error).toBe('The image is larger than 1 MB.')
    expect(h.setWidgetLogo).not.toHaveBeenCalled()
  })

  it('refuses on the declared length alone, before reading the body', async () => {
    const req = new Request('https://app.test/api/settings/widget-logo', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(50 * 1024 * 1024) },
      body: 'x',
    })
    const res = await post(req)
    expect(res.status).toBe(413)
  })

  it('refuses a body that outgrows the cap although it declared nothing', async () => {
    const req = new Request('https://app.test/api/settings/widget-logo', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body: Buffer.alloc(2 * 1024 * 1024),
    })
    const res = await post(req)
    expect(res.status).toBe(413)
    expect(h.setWidgetLogo).not.toHaveBeenCalled()
  })

  it('refuses a request that is not a file upload', async () => {
    const res = await post(new Request('https://app.test/api/settings/widget-logo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
    expect(res.status).toBe(400)
  })

  it('refuses a form with no file', async () => {
    const fd = new FormData()
    fd.set('note', 'hello')
    const res = await post(new Request('https://app.test/api/settings/widget-logo', { method: 'POST', body: fd }))
    expect(res.status).toBe(400)
    expect((await body(res)).error).toBe('Choose an image to upload.')
  })

  it('refuses an image with too many pixels', async () => {
    const huge = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#2563eb' } }).png({ compressionLevel: 9 }).toBuffer()
    const res = await post(uploadRequest(huge))
    expect(res.status).toBe(400)
    expect((await body(res)).code).toBe('too-many-pixels')
  })

  it('does not call a storage failure the visitor\'s fault, and says nothing technical', async () => {
    h.setWidgetLogo.mockRejectedValueOnce(new Error('connection refused to 10.0.0.5:5432'))
    const res = await post(uploadRequest(await png()))
    expect(res.status).toBe(500)
    expect((await body(res)).error).toBe('We could not save that logo. Try again.')
  })
})

describe('DELETE', () => {
  async function remove() {
    const { DELETE } = await import('@/app/api/settings/widget-logo/route')
    return DELETE()
  }

  it('removes the signed-in workspace\'s logo', async () => {
    const res = await remove()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ logoUrl: null })
    expect(h.deleteWidgetLogo).toHaveBeenCalledWith(7)
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('works on any plan, so a workspace can always delete what it uploaded', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    expect((await remove()).status).toBe(200)
    expect(h.deleteWidgetLogo).toHaveBeenCalledWith(7)
  })

  it('refuses someone who is not signed in or not an owner or admin', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect((await remove()).status).toBe(401)
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Forbidden' })
    expect((await remove()).status).toBe(403)
    expect(h.deleteWidgetLogo).not.toHaveBeenCalled()
  })
})
