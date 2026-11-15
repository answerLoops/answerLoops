import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Two of the four call sites run for real with their collaborators faked: the
 * Agent API's generate_answer and Discord's /ask route. The scheduler is
 * replaced by a spy that returns a promise that never settles, so a call site
 * that awaited it (or chained the reply onto it) would hang, and these tests
 * would time out. The reply must come back unchanged, the scheduler must be
 * called once after the generated record, and never on a failed answer.
 */

const ANSWER_ID = '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44'

class NoProvider extends Error {
  skipReason = 'no_provider'
}

const h = vi.hoisted(() => ({
  order: [] as string[],
  prior: [] as Array<{ summary: string; answer: string; articleId?: number }>,
  kbResults: [] as Array<{ id: number; question: string; answer: string }>,
  generate: vi.fn(),
  recordAnswerSources: vi.fn(),
  scheduleSourceSupport: vi.fn(),
}))

function common() {
  vi.doMock('@mastra/core/agent', () => ({ Agent: class { generate = h.generate } }))
  vi.doMock('@/lib/ai/models', () => ({
    chatModel: async () => ({}),
    DEFAULT_CHAT_MODEL: 'default',
    NoAIProviderConfiguredError: NoProvider,
  }))
  vi.doMock('@/lib/ai/errors', () => ({ aiUnavailableMessage: () => 'AI unavailable' }))
  vi.doMock('@/lib/ai/embed', () => ({ embedText: async () => [0.1] }))
  vi.doMock('@/lib/db/queries/kb', () => ({ searchArticles: async () => h.kbResults, getKBContext: async () => h.prior }))
  vi.doMock('@/lib/kb/usage', () => ({
    countArticleUsage: async () => {},
    newAnswerId: () => ANSWER_ID,
    recordAnswerSources: h.recordAnswerSources,
  }))
  vi.doMock('@/lib/kb/support/runner', () => ({ scheduleSourceSupport: h.scheduleSourceSupport }))
  vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.order = []
  h.prior = []
  h.kbResults = []
  h.generate.mockResolvedValue({ text: 'the answer' })
  h.recordAnswerSources.mockImplementation(async (input: { outcome: string }) => {
    h.order.push(`record:${input.outcome}`)
  })
  // Never settles: awaiting it anywhere on the reply path would hang the test.
  h.scheduleSourceSupport.mockImplementation(() => {
    h.order.push('schedule')
    return new Promise(() => {})
  })
  common()
})

describe('Agent API generate_answer', () => {
  beforeEach(() => {
    vi.doMock('@/lib/db/queries/faq', () => ({ getLatestFAQ: vi.fn() }))
    vi.doMock('@/lib/db/queries/tickets', () => ({ getTickets: vi.fn(), encodeTicketCursor: vi.fn(), decodeTicketCursor: vi.fn() }))
    vi.doMock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: vi.fn() }))
    vi.doMock('@/lib/ai/assess', () => ({
      assessAnswer: async () => ({ confidence: 0.9, answered_fully: true, reasoning: '' }),
      shouldAutoDeflect: () => true,
    }))
    vi.doMock('@/lib/billing/usage', () => ({
      reserveGeneration: async () => ({ granted: true, generationId: 1 }),
      commitDeflection: async () => true,
    }))
  })

  const run = async () => {
    const { generateAnswerCore } = await import('@/lib/agent/core')
    return generateAnswerCore(7, { question: 'How do I reset my password?' })
  }

  it('schedules once, after the generated record, with the question, the answer and the grounding context', async () => {
    h.prior = [{ summary: 'Reset', answer: 'Use Forgot password.', articleId: 11 }]
    await run()
    expect(h.order).toEqual(['record:generated', 'schedule'])
    expect(h.scheduleSourceSupport).toHaveBeenCalledWith({
      orgId: 7,
      answerId: ANSWER_ID,
      surface: 'agent_api',
      question: 'How do I reset my password?',
      answer: 'the answer',
      context: h.prior,
    })
  })

  it('returns the same result with the scheduler present as with it doing nothing at all', async () => {
    const withPending = await run()
    vi.resetModules()
    common()
    h.scheduleSourceSupport.mockImplementation(() => undefined)
    const withNothing = await run()
    expect(withPending).toEqual(withNothing)
    expect(withPending.ok).toBe(true)
  })

  it('does not schedule for a failed generation', async () => {
    h.generate.mockRejectedValue(new Error('model exploded'))
    await expect(run()).rejects.toThrow('model exploded')
    expect(h.scheduleSourceSupport).not.toHaveBeenCalled()
  })
})

describe('Discord /ask', () => {
  beforeEach(() => {
    vi.doMock('@/lib/db/queries/integrations', () => ({ getIntegrationByBotSecret: async () => ({ org_id: 5 }) }))
    vi.doMock('@/lib/db/schema', () => ({ DEFAULT_ORG_ID: 1 }))
    vi.doMock('@/lib/billing/usage', () => ({
      reserveGeneration: async () => ({ granted: true, generationId: 1 }),
      commitDeflection: async () => true,
    }))
    vi.doMock('@/lib/billing/entitlements-server', () => ({ orgRateLimitPerMinute: async () => 100 }))
    vi.doMock('@/lib/ratelimit', () => ({ rateLimitShared: async () => ({ ok: true }) }))
    vi.doMock('@/lib/http/bearer-auth', () => ({ getBearerToken: () => 'bot-secret', matchesPlatformBotSecret: () => false }))
  })

  const ask = async () => {
    const { POST } = await import('@/app/api/slash/ask/route')
    return POST(
      new Request('http://localhost/api/slash/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer bot-secret' },
        body: JSON.stringify({ question: 'How do I reset my password?', channel_id: 'c1' }),
      })
    )
  }

  it('replies with the answer and schedules once, after the generated record, with the article text kept in memory', async () => {
    h.kbResults = [{ id: 21, question: 'Reset', answer: 'Use Forgot password.' }]
    const res = await ask()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ answer: 'the answer' })
    expect(h.order).toEqual(['record:generated', 'schedule'])
    expect(h.recordAnswerSources.mock.calls[0][0].context).toEqual([{ articleId: 21 }])
    expect(h.scheduleSourceSupport).toHaveBeenCalledWith({
      orgId: 5,
      answerId: ANSWER_ID,
      surface: 'discord',
      question: 'How do I reset my password?',
      answer: 'the answer',
      context: [{ articleId: 21, summary: 'Reset', answer: 'Use Forgot password.' }],
    })
  })

  it('does not schedule when generation fails, and the error reply is unchanged', async () => {
    h.generate.mockRejectedValue(new Error('model exploded'))
    const res = await ask()
    expect(res.status).toBe(500)
    expect(h.scheduleSourceSupport).not.toHaveBeenCalled()
    expect(h.order).toEqual(['record:failed'])
  })
})
