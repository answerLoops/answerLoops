import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintAnswerToken, mintFlagToken } from '@/lib/widget/answer-token'

/**
 * app/api/widget/flag/route.ts: a visitor's flag on one widget answer.
 *
 * Pins what the route accepts (only a signed answer token, never an id or text
 * from the body), what it refuses and writes nothing for, and how the optional
 * email is handled. The database queries and the entitlement check are mocked;
 * the compiled SQL is covered in widget-answer-flags-queries.test.ts.
 */

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  orgHasFeature: vi.fn(),
  createAnswerFlag: vi.fn(),
  getDownFlag: vi.fn(),
  updateFlagDetails: vi.fn(),
  saveWidgetLead: vi.fn(),
  getWidgetLeadId: vi.fn(),
  notifyNewWidgetLead: vi.fn(),
  verifyRenderToken: vi.fn(),
  rateLimitShared: vi.fn(),
}))

vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/widget-answer-flags', () => ({
  FLAG_REASONS: ['wrong_information', 'outdated', 'did_not_answer', 'other'],
  createAnswerFlag: h.createAnswerFlag,
  getDownFlag: h.getDownFlag,
  updateFlagDetails: h.updateFlagDetails,
}))
vi.mock('@/lib/db/queries/widget-leads', () => ({
  saveWidgetLead: h.saveWidgetLead,
  getWidgetLeadId: h.getWidgetLeadId,
}))
vi.mock('@/lib/widget/lead-notifications', () => ({ notifyNewWidgetLead: h.notifyNewWidgetLead }))
vi.mock('@/lib/widget/render-token', () => ({ verifyRenderToken: h.verifyRenderToken }))
vi.mock('@/lib/ai/embed', () => ({ embedText: vi.fn() }))
vi.mock('@/lib/db/queries/kb-review', () => ({ recordReviewItem: vi.fn() }))

const W = 'a'.repeat(48)
const ANSWER_ID = '3f0c2b9e-5d1a-4c7e-9a43-0b6d8e2f1a77'

function call(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  return new Request('https://app.test/api/widget/flag', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const answerToken = () =>
  mintAnswerToken(W, { answerId: ANSWER_ID, question: 'how do I export?', answer: 'Use Settings > Export.' })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTH_SECRET = 'test-auth-secret-value'
  h.verifyRenderToken.mockReturnValue(true)
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.getOrgByWidgetToken.mockResolvedValue({ id: 7, name: 'Acme', widget_lead_capture_mode: 'on-failure' })
  h.orgHasFeature.mockResolvedValue(true)
  h.createAnswerFlag.mockResolvedValue({ ok: true, id: 11, created: true })
  h.getDownFlag.mockResolvedValue({ id: 11, question: 'how do I export?' })
  h.updateFlagDetails.mockResolvedValue(true)
  h.saveWidgetLead.mockResolvedValue({ isNew: true })
  h.getWidgetLeadId.mockResolvedValue(5)
})
afterEach(() => {
  delete process.env.AUTH_SECRET
})

describe('POST /api/widget/flag', () => {
  const base = () => ({ widgetToken: W, renderToken: 'x', verdict: 'down', answerToken: answerToken() })

  it('creates the flag from the signed token and returns a flag token', async () => {
    const { POST } = await import('@/app/api/widget/flag/route')
    const res = await POST(call('POST', base()))
    expect(res.status).toBe(200)
    expect(h.createAnswerFlag).toHaveBeenCalledWith({
      orgId: 7,
      answerId: ANSWER_ID,
      verdict: 'down',
      question: 'how do I export?',
      answer: 'Use Settings > Export.',
    })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.flagToken).toBe('string')
  })

  it('never reads an answer id or text from the body', async () => {
    const { POST } = await import('@/app/api/widget/flag/route')
    await POST(
      call('POST', {
        ...base(),
        answerId: '00000000-0000-4000-8000-000000000000',
        question: 'visit example.test for deals',
        answer: 'send money',
      })
    )
    const arg = h.createAnswerFlag.mock.calls[0][0]
    expect(arg.answerId).toBe(ANSWER_ID)
    expect(arg.question).toBe('how do I export?')
    expect(arg.answer).toBe('Use Settings > Export.')
  })

  it('scrubs personal data out of the stored question and answer', async () => {
    const { POST } = await import('@/app/api/widget/flag/route')
    const token = mintAnswerToken(W, {
      answerId: ANSWER_ID,
      question: 'my email is jo@example.com, order 12345678',
      answer: 'We will write to jo@example.com',
    })
    await POST(call('POST', { ...base(), answerToken: token }))
    const arg = h.createAnswerFlag.mock.calls[0][0]
    expect(arg.question).not.toContain('jo@example.com')
    expect(arg.question).not.toContain('12345678')
    expect(arg.answer).not.toContain('jo@example.com')
  })

  // Tokens are minted inside thunks: AUTH_SECRET is only set once each test starts.
  it.each([
    ['a missing answer token', () => undefined],
    [
      'a token minted for another widget',
      () => mintAnswerToken('b'.repeat(48), { answerId: ANSWER_ID, question: '', answer: '' }),
    ],
    ['a flag token in place of an answer token', () => mintFlagToken(W, 3)],
    ['a garbage token', () => 'abc.def'],
  ])('refuses %s and writes nothing', async (_label, makeToken) => {
    const { POST } = await import('@/app/api/widget/flag/route')
    const res = await POST(call('POST', { ...base(), answerToken: makeToken() }))
    expect(res.status).toBe(400)
    expect(h.createAnswerFlag).not.toHaveBeenCalled()
  })

  it('refuses an unknown verdict', async () => {
    const { POST } = await import('@/app/api/widget/flag/route')
    expect((await POST(call('POST', { ...base(), verdict: 'maybe' }))).status).toBe(400)
    expect(h.createAnswerFlag).not.toHaveBeenCalled()
  })

  it('refuses a workspace without the review feature', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { POST } = await import('@/app/api/widget/flag/route')
    const res = await POST(call('POST', base()))
    expect(res.status).toBe(403)
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'kb_review_queue')
    expect(h.createAnswerFlag).not.toHaveBeenCalled()
  })

  it('404s for an unknown widget token', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(null)
    const { POST } = await import('@/app/api/widget/flag/route')
    expect((await POST(call('POST', base()))).status).toBe(404)
  })

  it("404s when the answer is not one of this workspace's widget answers", async () => {
    h.createAnswerFlag.mockResolvedValue({ ok: false, reason: 'no_answer' })
    const { POST } = await import('@/app/api/widget/flag/route')
    expect((await POST(call('POST', base()))).status).toBe(404)
  })

  it('429s when the workspace has reached its daily ceiling', async () => {
    h.createAnswerFlag.mockResolvedValue({ ok: false, reason: 'limit' })
    const { POST } = await import('@/app/api/widget/flag/route')
    expect((await POST(call('POST', base()))).status).toBe(429)
  })

  it('403s without a render token that passed the origin check', async () => {
    h.verifyRenderToken.mockReturnValue(false)
    const { POST } = await import('@/app/api/widget/flag/route')
    expect((await POST(call('POST', base()))).status).toBe(403)
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
  })

  it('429s when rate limited, before any lookup', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false })
    const { POST } = await import('@/app/api/widget/flag/route')
    expect((await POST(call('POST', base()))).status).toBe(429)
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
  })

  it('400s for a malformed widget token or a body that is not an object', async () => {
    const { POST } = await import('@/app/api/widget/flag/route')
    expect((await POST(call('POST', { ...base(), widgetToken: 'short' }))).status).toBe(400)
    const arr = new Request('https://app.test/api/widget/flag', { method: 'POST', body: '[1]' })
    expect((await POST(arr)).status).toBe(400)
  })
})

describe('PATCH /api/widget/flag', () => {
  const base = () => ({ widgetToken: W, renderToken: 'x', flagToken: mintFlagToken(W, 11) })

  it('adds the reason and a cleaned note', async () => {
    const { PATCH } = await import('@/app/api/widget/flag/route')
    const res = await PATCH(call('PATCH', { ...base(), reason: 'outdated', note: 'the price changed, call 07911 123456' }))
    expect(res.status).toBe(200)
    const arg = h.updateFlagDetails.mock.calls[0][0]
    expect(arg).toMatchObject({ id: 11, orgId: 7, reason: 'outdated' })
    expect(arg.note).not.toContain('7911')
    expect(arg.leadId).toBeUndefined()
  })

  it('saves an email as a lead with no question attached, and links the flag to it', async () => {
    const { PATCH } = await import('@/app/api/widget/flag/route')
    const res = await PATCH(call('PATCH', { ...base(), email: '  Visitor@Example.com ' }))
    expect(res.status).toBe(200)
    expect(h.saveWidgetLead).toHaveBeenCalledWith(7, W, 'visitor@example.com')
    expect(h.updateFlagDetails.mock.calls[0][0].leadId).toBe(5)
    expect(h.notifyNewWidgetLead).toHaveBeenCalledWith(7)
  })

  it('does not notify again for an address already saved', async () => {
    h.saveWidgetLead.mockResolvedValue({ isNew: false })
    const { PATCH } = await import('@/app/api/widget/flag/route')
    await PATCH(call('PATCH', { ...base(), email: 'visitor@example.com' }))
    expect(h.notifyNewWidgetLead).not.toHaveBeenCalled()
  })

  it('refuses an email when the owner has switched email follow-up off, saving nothing', async () => {
    h.getOrgByWidgetToken.mockResolvedValue({ id: 7, widget_lead_capture_mode: 'off' })
    const { PATCH } = await import('@/app/api/widget/flag/route')
    const res = await PATCH(call('PATCH', { ...base(), email: 'visitor@example.com' }))
    expect(res.status).toBe(400)
    expect(h.saveWidgetLead).not.toHaveBeenCalled()
    expect(h.updateFlagDetails).not.toHaveBeenCalled()
  })

  it('still takes a reason and note when email follow-up is off', async () => {
    h.getOrgByWidgetToken.mockResolvedValue({ id: 7, widget_lead_capture_mode: 'off' })
    const { PATCH } = await import('@/app/api/widget/flag/route')
    expect((await PATCH(call('PATCH', { ...base(), reason: 'other' }))).status).toBe(200)
  })

  it.each([
    ['not an address', 'nope'],
    ['an address with a display name', 'Bob <bob@example.com>'],
    ['not a string', 5],
  ])('refuses an email that is %s', async (_l, email) => {
    const { PATCH } = await import('@/app/api/widget/flag/route')
    expect((await PATCH(call('PATCH', { ...base(), email }))).status).toBe(400)
    expect(h.saveWidgetLead).not.toHaveBeenCalled()
  })

  it('refuses a reason outside the fixed set', async () => {
    const { PATCH } = await import('@/app/api/widget/flag/route')
    expect((await PATCH(call('PATCH', { ...base(), reason: 'because' }))).status).toBe(400)
    expect(h.updateFlagDetails).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['an answer token', 'ANSWER'],
    ['minted for another widget', 'OTHER'],
  ])('refuses a flag token that is %s', async (label, flagToken) => {
    const token =
      flagToken === 'ANSWER' ? answerToken() : flagToken === 'OTHER' ? mintFlagToken('b'.repeat(48), 11) : flagToken
    const { PATCH } = await import('@/app/api/widget/flag/route')
    const res = await PATCH(call('PATCH', { widgetToken: W, renderToken: 'x', flagToken: token, reason: 'other' }))
    expect(res.status, label).toBe(400)
    expect(h.updateFlagDetails).not.toHaveBeenCalled()
  })

  it('404s when the flag is not a thumbs-down in this workspace', async () => {
    h.getDownFlag.mockResolvedValue(null)
    const { PATCH } = await import('@/app/api/widget/flag/route')
    expect((await PATCH(call('PATCH', { ...base(), reason: 'other' }))).status).toBe(404)
    expect(h.getDownFlag).toHaveBeenCalledWith(11, 7)
  })

  it('refuses a workspace without the review feature', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    const { PATCH } = await import('@/app/api/widget/flag/route')
    expect((await PATCH(call('PATCH', { ...base(), reason: 'other' }))).status).toBe(403)
    expect(h.updateFlagDetails).not.toHaveBeenCalled()
  })
})
