import { describe, it, expect, vi, beforeEach } from 'vitest'
import { widgetChatRequest, drain, userMsg, assistantMsg } from './support/widget-chat-envelope'

/**
 * Behavioural coverage for app/api/widget/chat/route.ts.
 *
 * The existing widget abuse tests (widget-abuse-hardening.test.ts,
 * widget-surface-hardening.test.ts) are readFileSync + toContain assertions
 * against the route's source text. They pass whether or not the route behaves
 * correctly, and they break on harmless refactors — the exact inversion of what
 * a test should do. Nothing in the suite imported either widget route handler
 * before this file.
 *
 * The property under test: a widget token is public by design (it ships in the
 * customer's HTML), so every control on this route is keyed on an identifier
 * anyone can read off the page, and the route has to hold on its own terms.
 * Quota reservation must not happen until the request is known to be
 * well-formed, since attempts are capped at a multiple of the plan's monthly
 * allowance and a reservation left behind by a rejected request consumes quota
 * the org never used.
 *
 * The route is a CopilotKit single-route runtime endpoint: every request is a
 * POST carrying `{ method: "agent/run", body: { messages, forwardedProps } }`
 * (see CopilotKitProvider's `useSingleEndpoint`), with the widget token and
 * visitor id riding in `forwardedProps` rather than at the envelope's top
 * level, and AG-UI messages shaped as `{ role, content }` rather than the AI
 * SDK's `{ role, parts }`. All of this route's own validation runs inside the
 * `onRequest` hook, before the CopilotKit runtime ever dispatches to the agent
 * factory — so a rejection here is a real HTTP status, not an AG-UI error
 * event.
 */

const VALID_TOKEN = 'a'.repeat(48) // crypto.randomBytes(24).toString('hex') shape

const h = vi.hoisted(() => ({
  reserveGeneration: vi.fn(),
  releaseGeneration: vi.fn(),
  commitDeflection: vi.fn(),
  rateLimitShared: vi.fn(),
  getOrgByWidgetToken: vi.fn(),
  chatModel: vi.fn(),
  streamCalls: [] as { query: string }[],
}))

class FakeNoProviderError extends Error {}

vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: h.reserveGeneration,
  releaseGeneration: h.releaseGeneration,
  commitDeflection: h.commitDeflection,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/ai/models', () => ({
  chatModel: h.chatModel,
  DEFAULT_FAST_MODEL: 'fake-model',
  NoAIProviderConfiguredError: FakeNoProviderError,
}))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/ai/embed', () => ({ embedText: vi.fn(async () => [0.1]) }))
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: vi.fn(async () => []) }))
vi.mock('@/lib/db/queries/embeddings', () => ({
  getPriorAnswers: vi.fn(async () => []),
  getCandidateVectors: vi.fn(async () => []),
}))
vi.mock('@/lib/ai/related', () => ({ findRelated: () => [] }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    async stream(query: string) {
      h.streamCalls.push({ query })
      return { fullStream: new ReadableStream({ start: (c) => c.close() }) }
    }
  },
}))

async function callRoute(body: { widgetToken?: unknown; visitorId?: unknown; messages?: unknown }) {
  const { POST } = await import('@/app/api/widget/chat/route')
  return POST(widgetChatRequest(body))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.streamCalls.length = 0
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.getOrgByWidgetToken.mockResolvedValue({
    id: 42,
    name: 'Acme',
    widget_token: VALID_TOKEN,
    plan_id: 'starter',
    widget_allowed_origins: null,
  })
  h.reserveGeneration.mockResolvedValue({ granted: true, generationId: 7 })
  h.chatModel.mockResolvedValue({ id: 'fake-model' })
})

describe('widget chat: the request body is capped before it is parsed', () => {
  it('returns 413 for an oversized body without reserving quota, before JSON is even parsed', async () => {
    // A single ~600KB message content string, past MAX_BODY_BYTES (512KB) —
    // large enough that if the cap were dropped, JSON.parse would still
    // succeed and the per-message MAX_MESSAGE_CHARS check would have to catch
    // it instead. The point here is that it never gets that far.
    const oversizedContent = 'x'.repeat(600 * 1024)
    const req = new Request('https://app.test/api/widget/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'agent/run',
        params: { agentId: 'default' },
        body: {
          threadId: 'thread-1',
          runId: 'run-1',
          tools: [],
          context: [],
          messages: [userMsg(oversizedContent)],
          forwardedProps: { widgetToken: VALID_TOKEN, visitorId: 'v' },
        },
      }),
    })
    const { POST } = await import('@/app/api/widget/chat/route')
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(h.reserveGeneration).not.toHaveBeenCalled()
    expect(h.streamCalls).toHaveLength(0)
  })
})

describe('widget chat: no rejected request may consume quota', () => {
  // Each case is a request the route rejects. None may reserve, because a
  // reservation it never releases is a permanent attempt against the org.
  const rejected: [string, { widgetToken?: unknown; visitorId?: unknown; messages?: unknown }][] = [
    ['malformed token shape', { widgetToken: 'not-hex', visitorId: 'v', messages: [userMsg('hi')] }],
    ['missing token', { visitorId: 'v', messages: [userMsg('hi')] }],
    ['missing visitorId', { widgetToken: VALID_TOKEN, messages: [userMsg('hi')] }],
    ['empty messages', { widgetToken: VALID_TOKEN, visitorId: 'v', messages: [] }],
    ['null message element', { widgetToken: VALID_TOKEN, visitorId: 'v', messages: [null] }],
    ['non-string content', { widgetToken: VALID_TOKEN, visitorId: 'v', messages: [{ role: 'user', content: 42 }] }],
    ['oversized message', { widgetToken: VALID_TOKEN, visitorId: 'v', messages: [userMsg('x'.repeat(4001))] }],
    ['whitespace-only query', { widgetToken: VALID_TOKEN, visitorId: 'v', messages: [userMsg('   ')] }],
  ]

  it.each(rejected)('%s is rejected without reserving quota', async (_label, body) => {
    const res = await callRoute(body)
    expect(res.status).toBe(400)
    expect(h.reserveGeneration).not.toHaveBeenCalled()
    expect(h.streamCalls).toHaveLength(0)
  })

  it('a well-formed request still reserves and reaches the model', async () => {
    // Guards the tests above from passing vacuously — if the route rejected
    // everything, every case above would pass and this one would fail.
    const res = await callRoute({ widgetToken: VALID_TOKEN, visitorId: 'v', messages: [userMsg('how do I install?')] })
    expect(res.status).toBe(200)
    await drain(res)
    expect(h.reserveGeneration).toHaveBeenCalledOnce()
    expect(h.streamCalls).toHaveLength(1)
    expect(h.releaseGeneration).not.toHaveBeenCalled()
  })
})

describe('widget chat: the last user message is what reaches the model', () => {
  it('picks the most recent user message when several are present', async () => {
    const res = await callRoute({
      widgetToken: VALID_TOKEN,
      visitorId: 'v',
      messages: [userMsg('first question'), assistantMsg('reply'), userMsg('second question')],
    })
    expect(res.status).toBe(200)
    await drain(res)
    expect(h.streamCalls[0].query).toBe('second question')
  })
})

describe('widget chat: malformed input is a 400, never an unhandled 500', () => {
  it.each([
    ['null element', [null]],
    ['string element', ['nope']],
    ['non-string content', [{ role: 'user', content: 42 }]],
    ['missing role', [{ content: 'hi' }]],
  ])('%s returns 400', async (_label, messages) => {
    const res = await callRoute({ widgetToken: VALID_TOKEN, visitorId: 'v', messages })
    expect(res.status).toBe(400)
  })
})

describe('widget chat: the token is validated before it becomes rate-limiter key material', () => {
  it('does not touch the rate limiter for a malformed token', async () => {
    // The limiter persists this key and cannot bound what it is handed, so the
    // token's format is checked before it ever gets there.
    const res = await callRoute({ widgetToken: 'z'.repeat(5000), visitorId: 'v', messages: [userMsg('hi')] })
    expect(res.status).toBe(400)
    expect(h.rateLimitShared).not.toHaveBeenCalled()
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
  })

  it('accepts a correctly shaped token', async () => {
    const res = await callRoute({ widgetToken: VALID_TOKEN, visitorId: 'v', messages: [userMsg('hi')] })
    expect(res.status).toBe(200)
    expect(h.rateLimitShared).toHaveBeenCalled()
  })
})

describe('widget chat: a reservation that never reaches the model is released', () => {
  it('releases when the org has no AI provider configured', async () => {
    h.chatModel.mockRejectedValueOnce(new FakeNoProviderError('none'))
    const res = await callRoute({ widgetToken: VALID_TOKEN, visitorId: 'v', messages: [userMsg('hi')] })
    expect(res.status).toBe(503)
    // Without this the org is charged an attempt per visitor request for its
    // own misconfiguration, which is exactly how the quota gets drained.
    expect(h.releaseGeneration).toHaveBeenCalledWith(7)
  })

  it('does not release once the model has actually been reached', async () => {
    const res = await callRoute({ widgetToken: VALID_TOKEN, visitorId: 'v', messages: [userMsg('hi')] })
    expect(res.status).toBe(200)
    await drain(res)
    expect(h.releaseGeneration).not.toHaveBeenCalled()
  })
})

describe('widget chat: quota exhaustion is still enforced', () => {
  it('returns 402 when the reservation is denied', async () => {
    h.reserveGeneration.mockResolvedValueOnce({ granted: false, reason: 'deflection-limit', used: 500, limit: 500 })
    const res = await callRoute({ widgetToken: VALID_TOKEN, visitorId: 'v', messages: [userMsg('hi')] })
    expect(res.status).toBe(402)
    expect(h.streamCalls).toHaveLength(0)
  })
})
