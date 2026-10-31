import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for the `question` field added to app/api/widget/lead/route.ts —
 * the visitor's question, attached to the lead when it comes from the
 * widget's on-failure prompt (see issue #11's round-2 review: "the team sees
 * a bare address with nothing to follow up on"). The up-front gate sends no
 * question at all, since no conversation has happened yet at that point.
 *
 * A malformed question (wrong type, too long, blank) is never a 400 — it's
 * treated as simply absent. A lead missing its context is still a real lead
 * worth saving; the email is the only field this endpoint actually gates on.
 */

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  saveWidgetLead: vi.fn(async () => {}),
  verifyRenderToken: vi.fn(() => true),
}))

vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/db/queries/widget-leads', () => ({ saveWidgetLead: h.saveWidgetLead }))
vi.mock('@/lib/widget/render-token', () => ({ verifyRenderToken: h.verifyRenderToken }))

const VALID_TOKEN = 'a'.repeat(48)

function leadRequest(body: Record<string, unknown>) {
  return new Request('https://app.test/api/widget/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.verifyRenderToken.mockReturnValue(true)
  h.getOrgByWidgetToken.mockResolvedValue({ id: 7, name: 'Acme', widget_token: VALID_TOKEN })
})

describe('POST /api/widget/lead: question pass-through', () => {
  it('passes a well-formed question straight through, trimmed', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(
      leadRequest({
        widgetToken: VALID_TOKEN,
        renderToken: 'x',
        email: 'visitor@example.com',
        question: '  how do I export my data?  ',
      })
    )
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', 'how do I export my data?')
  })

  it('omits the question entirely when none is sent — the up-front gate has no conversation yet', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', email: 'visitor@example.com' }))
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', undefined)
  })

  it('treats a blank/whitespace-only question as absent, not a 400', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(
      leadRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', email: 'visitor@example.com', question: '   ' })
    )
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', undefined)
  })

  it('treats a non-string question as absent, not a 400', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(
      leadRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', email: 'visitor@example.com', question: 12345 })
    )
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', undefined)
  })

  it('treats an over-length question as absent rather than rejecting the whole lead', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const tooLong = 'x'.repeat(4001) // MAX_QUESTION_CHARS is 4000, matching the chat route's own per-message cap
    const res = await POST(
      leadRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', email: 'visitor@example.com', question: tooLong })
    )
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', undefined)
  })

  it('accepts a question at exactly the length cap', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const atCap = 'x'.repeat(4000)
    const res = await POST(
      leadRequest({ widgetToken: VALID_TOKEN, renderToken: 'x', email: 'visitor@example.com', question: atCap })
    )
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', atCap)
  })
})
