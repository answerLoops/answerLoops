import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for app/api/widget/lead-signal/route.ts — the endpoint the widget
 * client polls right after a chat turn finishes to decide whether to show the
 * on-failure lead-capture prompt (see lib/widget/lead-capture.ts, issue #11).
 * It does no model or KB work: it only validates the request, enforces the
 * render-token binding (same as the chat route — see Known Issue 114), rate
 * limits, resolves the org, and reads back whatever
 * lib/widget/lead-signal-stash.ts has for that org+visitor.
 *
 * Both the query layer and the stash are mocked wholesale so each side is
 * controlled independently of the other, same spirit as
 * widget-render-token-enforcement.test.ts but with verifyRenderToken itself
 * mocked (rather than minted for real) since this suite is about the route's
 * own branching, not Known Issue 114's token mechanics — those are covered by
 * widget-render-token-enforcement.test.ts and widget-render-token.test.ts.
 */

const h = vi.hoisted(() => ({
    getLeadSignal: vi.fn(),
  verifyRenderToken: vi.fn(),
}))

vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/widget/lead-signal-stash', () => ({ getLeadSignal: h.getLeadSignal }))
vi.mock('@/lib/widget/render-token', () => ({ verifyRenderToken: h.verifyRenderToken }))

const VALID_TOKEN = 'f'.repeat(48)

function leadSignalRequest(body: Record<string, unknown>) {
  return new Request('https://app.test/api/widget/lead-signal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.verifyRenderToken.mockReturnValue(true)
  h.getLeadSignal.mockReturnValue('none')
})

describe('POST /api/widget/lead-signal: validation', () => {
  it('400s on a missing widgetToken', async () => {
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    const res = await POST(leadSignalRequest({ renderToken: 'x', visitorId: 'v1' }))
    expect(res.status).toBe(400)
  })

  it('400s on a malformed widgetToken (wrong shape, not 48 hex chars)', async () => {
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    const res = await POST(leadSignalRequest({ widgetToken: 'not-hex', renderToken: 'x', visitorId: 'v1' }))
    expect(res.status).toBe(400)
  })

  it('400s on a missing visitorId', async () => {
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    const res = await POST(leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'x' }))
    expect(res.status).toBe(400)
  })

  it('400s on a malformed visitorId (disallowed characters / too long)', async () => {
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    for (const visitorId of ['has space', '../x', 'x'.repeat(65)]) {
      const res = await POST(leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', visitorId }))
      expect(res.status, visitorId).toBe(400)
    }
  })

  it('400s on invalid JSON', async () => {
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    const res = await POST(
      new Request('https://app.test/api/widget/lead-signal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      })
    )
    expect(res.status).toBe(400)
  })

  it('validates widgetToken shape before checking the render token', async () => {
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    await POST(leadSignalRequest({ widgetToken: 'bad', renderToken: 'x', visitorId: 'v1' }))
    expect(h.verifyRenderToken).not.toHaveBeenCalled()
  })
})

describe('POST /api/widget/lead-signal: render token enforcement', () => {
  it('403s when verifyRenderToken fails', async () => {
    h.verifyRenderToken.mockReturnValue(false)
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    const res = await POST(leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'stale', visitorId: 'v1' }))
    expect(res.status).toBe(403)
    expect(h.getLeadSignal).not.toHaveBeenCalled()
  })

  it('passes the widgetToken, renderToken and resolved ip through to verifyRenderToken', async () => {
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    await POST(leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'tok-123', visitorId: 'v1' }))
    expect(h.verifyRenderToken).toHaveBeenCalledWith('tok-123', VALID_TOKEN, '203.0.113.9')
  })
})

describe('POST /api/widget/lead-signal: success', () => {
  it('returns whatever getLeadSignal reports, scoped to the widget token, visitor and tab in the request', async () => {
    h.getLeadSignal.mockReturnValue('human-requested')
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    const res = await POST(
      leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', visitorId: 'visitor-42', sessionId: 'tab-9' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ signal: 'human-requested' })
    expect(h.getLeadSignal).toHaveBeenCalledWith(VALID_TOKEN, 'visitor-42', 'tab-9')
  })

  it('reads the shared "legacy" scope when the page sent no valid session id', async () => {
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    await POST(leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', visitorId: 'v1' }))
    await POST(leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', visitorId: 'v1', sessionId: 'a:b' }))
    expect(h.getLeadSignal).toHaveBeenNthCalledWith(1, VALID_TOKEN, 'v1', 'legacy')
    expect(h.getLeadSignal).toHaveBeenNthCalledWith(2, VALID_TOKEN, 'v1', 'legacy')
  })

  it('returns "none" when no signal was ever stashed for this org+visitor', async () => {
    h.getLeadSignal.mockReturnValue('none')
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    const res = await POST(leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', visitorId: 'visitor-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ signal: 'none' })
  })

  it('returns "no-kb-match" when that is what was stashed', async () => {
    h.getLeadSignal.mockReturnValue('no-kb-match')
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    const res = await POST(leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', visitorId: 'visitor-1' }))
    expect(await res.json()).toEqual({ signal: 'no-kb-match' })
  })
})

describe('POST /api/widget/lead-signal: abuse controls', () => {
  it('429s when the rate limit is exceeded', async () => {
    vi.doMock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: false })) }))
    vi.resetModules()
    const { POST } = await import('@/app/api/widget/lead-signal/route')
    const res = await POST(leadSignalRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', visitorId: 'v1' }))
    expect(res.status).toBe(429)
    vi.doUnmock('@/lib/ratelimit')
    vi.resetModules()
  })
})
