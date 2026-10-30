import { describe, it, expect, vi, beforeEach } from 'vitest'

// app/api/widget/chat/route.ts — X-Widget-Lead-Signal header.
//
// Kept in its own file (rather than folded into
// tests/unit/widget-lead-capture-infra.test.ts) because this route test
// mocks '@/lib/db/queries/widgets' wholesale, the same way
// tests/unit/widget-kb-only-context.test.ts does; the infra file imports the
// *real* lib/db/queries/widgets module against a pg-proxy-mocked
// '@/lib/db/drizzle', and vi.mock calls are hoisted file-wide, so the two
// mocking styles cannot coexist in one file without one silently shadowing
// the other.

const h = vi.hoisted(() => ({
  getKBContext: vi.fn(),
  reserveGeneration: vi.fn(),
  getOrgByWidgetToken: vi.fn(),
}))

vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: h.getKBContext }))
vi.mock('@/lib/db/queries/embeddings', () => ({
  getPriorAnswers: vi.fn(),
  getCandidateVectors: vi.fn(),
}))
vi.mock('@/lib/billing/usage', () => ({
  reserveGeneration: h.reserveGeneration,
  commitDeflection: vi.fn(),
  releaseGeneration: vi.fn(),
}))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ai/embed', () => ({ embedText: vi.fn(async () => [0.1]) }))
vi.mock('@/lib/ai/memory', () => ({ getWidgetChatMemory: () => ({}) }))
vi.mock('@/lib/ai/models', () => ({
  chatModel: vi.fn(async () => ({ id: 'fake' })),
  DEFAULT_FAST_MODEL: 'fake',
  NoAIProviderConfiguredError: class extends Error {},
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    async stream() {
      return { textStream: new ReadableStream<string>({ start: (c) => c.close() }) }
    }
  },
}))

const VALID_TOKEN = 'b'.repeat(48)

async function ask(question = 'how do I install this?') {
  const { POST } = await import('@/app/api/widget/chat/route')
  return POST(
    new Request('https://app.test/api/widget/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        widgetToken: VALID_TOKEN,
        visitorId: 'v1',
        messages: [{ role: 'user', parts: [{ type: 'text', text: question }] }],
      }),
    })
  )
}

describe('app/api/widget/chat/route.ts: X-Widget-Lead-Signal header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getOrgByWidgetToken.mockResolvedValue({
      id: 7,
      name: 'Acme',
      widget_token: VALID_TOKEN,
      plan_id: 'starter',
      widget_allowed_origins: null,
      widget_lead_capture_mode: 'on-failure',
    })
    h.reserveGeneration.mockResolvedValue({ granted: true, generationId: 1 })
    h.getKBContext.mockResolvedValue([])
  })

  it('sets "no-kb-match" when getKBContext resolves to an empty array and the query does not ask for a human', async () => {
    h.getKBContext.mockResolvedValue([])
    const res = await ask('how do I reset my widget token')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Widget-Lead-Signal')).toBe('no-kb-match')
  })

  it('sets "none" when at least one KB article was found and the query does not ask for a human', async () => {
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])
    const res = await ask('how do I install this?')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Widget-Lead-Signal')).toBe('none')
  })

  it('sets "human-requested" when the query asks for a human, even though KB context was found', async () => {
    // Priority order per the route's comment: an explicit ask for a human is
    // the strongest signal regardless of whether the KB happened to return
    // something, so this must win over the "none" case above.
    h.getKBContext.mockResolvedValue([{ summary: 'Install', answer: 'Run npm i' }])
    const res = await ask('this is not working, can I talk to a human please')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Widget-Lead-Signal')).toBe('human-requested')
  })

  it('sets "human-requested" over "no-kb-match" when both conditions are true', async () => {
    h.getKBContext.mockResolvedValue([])
    const res = await ask('I want to speak with someone about this')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Widget-Lead-Signal')).toBe('human-requested')
  })
})
