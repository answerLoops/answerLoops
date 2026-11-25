import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What /api/widget/lead does about telling the team: one email for a first
 * submission, none for a repeat, run after the response, and never able to fail
 * the visitor's request.
 */

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  saveWidgetLead: vi.fn(),
  verifyRenderToken: vi.fn(() => true),
  notify: vi.fn(async () => {}),
  afterCallbacks: [] as Array<() => unknown>,
}))

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => unknown) => {
    h.afterCallbacks.push(fn)
  },
}))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/db/queries/widget-leads', () => ({ saveWidgetLead: h.saveWidgetLead }))
vi.mock('@/lib/widget/render-token', () => ({ verifyRenderToken: h.verifyRenderToken }))
vi.mock('@/lib/widget/lead-notifications', () => ({ notifyNewWidgetLead: h.notify }))

const TOKEN = 'a'.repeat(48)

function leadRequest(email = 'visitor@example.test') {
  return new Request('https://app.test/api/widget/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ widgetToken: TOKEN, renderToken: 'x', email }),
  })
}

async function runAfter() {
  for (const fn of h.afterCallbacks.splice(0)) await fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  h.afterCallbacks.length = 0
  process.env.AUTH_SECRET = 'test-auth-secret-value'
  h.verifyRenderToken.mockReturnValue(true)
  h.getOrgByWidgetToken.mockResolvedValue({ id: 7, name: 'Acme', widget_token: TOKEN })
  h.saveWidgetLead.mockResolvedValue({ isNew: true })
})
afterEach(() => {
  delete process.env.AUTH_SECRET
})

describe('POST /api/widget/lead: telling the team', () => {
  it('emails once for a new lead, after the response has been built', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    // Scheduled, not yet run: the visitor's response did not wait for it.
    expect(h.notify).not.toHaveBeenCalled()
    expect(h.afterCallbacks).toHaveLength(1)
    await runAfter()
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledWith(7)
  })

  it('sends nothing for a repeat of an address the workspace already has', async () => {
    h.saveWidgetLead.mockResolvedValue({ isNew: false })
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest())
    expect(res.status).toBe(200)
    await runAfter()
    expect(h.afterCallbacks).toHaveLength(0)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('saves the lead and answers 200 even if emailing the team later fails', async () => {
    h.notify.mockRejectedValueOnce(new Error('mail provider down'))
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest())
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledTimes(1)
  })

  it.each([
    'evil.com/x@example.com',
    'Name <visitor@example.com>',
    'visitor@192.168.0.1',
    'a@example.com,b@example.com',
    'visitor@example.com\nbcc:other@example.com',
    'vis..itor@example.com',
  ])('refuses the odd address %s: nothing is saved and nobody is emailed', async (address) => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest(address))
    expect(res.status).toBe(400)
    expect(h.saveWidgetLead).not.toHaveBeenCalled()
    expect(h.afterCallbacks).toHaveLength(0)
  })

  it('does not email for a request that was refused before anything was saved', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest('not-an-email'))
    expect(res.status).toBe(400)
    expect(h.saveWidgetLead).not.toHaveBeenCalled()
    expect(h.afterCallbacks).toHaveLength(0)
  })

  it('does not email for an unknown widget', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(null)
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest())
    expect(res.status).toBe(404)
    expect(h.afterCallbacks).toHaveLength(0)
  })
})
