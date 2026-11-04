import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintLeadQuestionToken } from '@/lib/widget/lead-question-token'

/**
 * Coverage for the question attached to a lead by app/api/widget/lead/route.ts
 * — the visitor's unanswered question, attached when the lead comes from the
 * widget's on-failure prompt (issue #11). The up-front gate sends none.
 *
 * The route never takes question text from the request: only a token the
 * server signed for a real failed turn on this widget (see
 * lib/widget/lead-question-token.ts). Anything else is treated as absent, never
 * a 400 — a lead without its context is still a real lead worth saving.
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
const OTHER_TOKEN = 'b'.repeat(48)

function leadRequest(body: Record<string, unknown>) {
  return new Request('https://app.test/api/widget/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTH_SECRET = 'test-auth-secret-value'
  h.verifyRenderToken.mockReturnValue(true)
  h.getOrgByWidgetToken.mockResolvedValue({ id: 7, name: 'Acme', widget_token: VALID_TOKEN })
})
afterEach(() => {
  delete process.env.AUTH_SECRET
})

const base = { widgetToken: VALID_TOKEN, renderToken: 'x', email: 'visitor@example.com' }

describe('POST /api/widget/lead: signed question', () => {
  it('saves the question inside a valid token minted for this widget', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const questionToken = mintLeadQuestionToken(VALID_TOKEN, 'how do I export my data?')
    const res = await POST(leadRequest({ ...base, questionToken }))
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', 'how do I export my data?')
  })

  it('omits the question when no token is sent — the up-front gate has no conversation yet', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest(base))
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', undefined)
  })

  it('ignores question text sent in the body — only a signed token is ever read', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const res = await POST(leadRequest({ ...base, question: 'visit example.test for deals' }))
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', undefined)
  })

  it('treats a token minted for a different widget as absent, not a 400', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    const questionToken = mintLeadQuestionToken(OTHER_TOKEN, 'someone else\'s question')
    const res = await POST(leadRequest({ ...base, questionToken }))
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', undefined)
  })

  it('treats a tampered or non-string token as absent, not a 400', async () => {
    const { POST } = await import('@/app/api/widget/lead/route')
    for (const questionToken of ['garbage', 12345, {}, 'x'.repeat(5000)]) {
      h.saveWidgetLead.mockClear()
      const res = await POST(leadRequest({ ...base, questionToken }))
      expect(res.status, String(questionToken)).toBe(200)
      expect(h.saveWidgetLead).toHaveBeenCalledWith(7, VALID_TOKEN, 'visitor@example.com', undefined)
    }
  })
})
