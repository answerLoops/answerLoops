import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * generate_answer (the Agent API and MCP path), run for real with its
 * collaborators faked: what it hands to the answer-source recorder for a
 * successful answer, a failed generation and a missing AI provider, and that a
 * failing recorder never changes what the caller gets back.
 */

const ANSWER_ID = '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44'

class NoProvider extends Error {
  skipReason = 'no_provider'
}

const h = vi.hoisted(() => ({
  prior: [] as Array<{ summary: string; answer: string; articleId?: number }>,
  generate: vi.fn(),
  recordAnswerSources: vi.fn(),
  countArticleUsage: vi.fn(),
  newAnswerId: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.prior = []
  h.generate.mockResolvedValue({ text: 'the answer' })
  h.recordAnswerSources.mockResolvedValue(undefined)
  h.countArticleUsage.mockResolvedValue(undefined)
  h.newAnswerId.mockReturnValue(ANSWER_ID)

  vi.doMock('@mastra/core/agent', () => ({ Agent: class { generate = h.generate } }))
  vi.doMock('@/lib/ai/models', () => ({
    chatModel: async () => ({}),
    DEFAULT_CHAT_MODEL: 'default',
    NoAIProviderConfiguredError: NoProvider,
  }))
  vi.doMock('@/lib/ai/errors', () => ({ aiUnavailableMessage: () => 'AI unavailable' }))
  vi.doMock('@/lib/ai/embed', () => ({ embedText: async () => [0.1] }))
  vi.doMock('@/lib/db/queries/kb', () => ({ searchArticles: vi.fn(), getKBContext: async () => h.prior }))
  vi.doMock('@/lib/db/queries/faq', () => ({ getLatestFAQ: vi.fn() }))
  vi.doMock('@/lib/db/queries/tickets', () => ({ getTickets: vi.fn(), encodeTicketCursor: vi.fn(), decodeTicketCursor: vi.fn() }))
  vi.doMock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: vi.fn() }))
  vi.doMock('@/lib/ai/assess', () => ({
    assessAnswer: async () => ({ confidence: 0.1, answered_fully: false, reasoning: '' }),
    shouldAutoDeflect: () => false,
  }))
  vi.doMock('@/lib/billing/usage', () => ({
    reserveGeneration: async () => ({ granted: true, generationId: 1 }),
    commitDeflection: async () => true,
  }))
  vi.doMock('@/lib/kb/usage', () => ({
    countArticleUsage: h.countArticleUsage,
    newAnswerId: h.newAnswerId,
    recordAnswerSources: h.recordAnswerSources,
  }))
  vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
})

async function generate() {
  const { generateAnswerCore } = await import('@/lib/agent/core')
  return generateAnswerCore(7, { question: 'How do I reset my password?' })
}

describe('generate_answer records which articles it was given', () => {
  it('stores articles A, B and C for the answer, with the Agent API surface and a generated outcome', async () => {
    h.prior = [
      { summary: 'A', answer: 'a', articleId: 11 },
      { summary: 'B', answer: 'b', articleId: 12 },
      { summary: 'C', answer: 'c', articleId: 13 },
    ]
    const res = await generate()
    expect(res.ok).toBe(true)
    expect(h.recordAnswerSources).toHaveBeenCalledTimes(1)
    expect(h.recordAnswerSources).toHaveBeenCalledWith({
      orgId: 7,
      answerId: ANSWER_ID,
      surface: 'agent_api',
      outcome: 'generated',
      context: h.prior,
    })
  })

  it('uses the one id made for this generation, and makes exactly one', async () => {
    await generate()
    expect(h.newAnswerId).toHaveBeenCalledTimes(1)
    expect(h.recordAnswerSources.mock.calls[0][0].answerId).toBe(ANSWER_ID)
  })

  it('counts usage as before, in addition to recording', async () => {
    h.prior = [{ summary: 'A', answer: 'a', articleId: 11 }]
    await generate()
    expect(h.countArticleUsage).toHaveBeenCalledWith(7, h.prior)
    expect(h.recordAnswerSources).toHaveBeenCalledTimes(1)
  })

  it('records an answer with nothing supplied when no article matched', async () => {
    await generate()
    expect(h.recordAnswerSources.mock.calls[0][0].context).toEqual([])
  })

  it('passes entries reused from earlier tickets through unchanged; the recorder ignores them', async () => {
    h.prior = [{ summary: 'from a ticket', answer: 'x' }, { summary: 'A', answer: 'a', articleId: 11 }]
    await generate()
    expect(h.recordAnswerSources.mock.calls[0][0].context).toEqual(h.prior)
  })
})

describe('generate_answer when generation fails', () => {
  it('records the supplied context with the failed outcome, still throws, and does not count usage', async () => {
    h.prior = [{ summary: 'A', answer: 'a', articleId: 11 }]
    h.generate.mockRejectedValue(new Error('model exploded'))
    await expect(generate()).rejects.toThrow('model exploded')
    expect(h.recordAnswerSources).toHaveBeenCalledTimes(1)
    expect(h.recordAnswerSources).toHaveBeenCalledWith({
      orgId: 7,
      answerId: ANSWER_ID,
      surface: 'agent_api',
      outcome: 'failed',
      context: h.prior,
    })
    expect(h.countArticleUsage).not.toHaveBeenCalled()
  })

  it('records nothing when no AI provider is configured, since nothing was generated', async () => {
    h.generate.mockRejectedValue(new NoProvider('no provider'))
    const res = await generate()
    expect(res.ok).toBe(false)
    expect(h.recordAnswerSources).not.toHaveBeenCalled()
  })
})

describe('generate_answer when recording itself breaks', () => {
  it('returns the same answer when the database write fails, because the real recorder swallows the error', async () => {
    const recordAnswerReferences = vi.fn().mockRejectedValue(new Error('db down'))
    const loggerError = vi.fn()
    vi.resetModules()
    vi.doUnmock('@/lib/kb/usage')
    vi.doMock('@/lib/db/queries/kb-answers', () => ({ recordAnswerReferences }))
    vi.doMock('@/lib/db/queries/kb-usage', () => ({ recordArticleUsage: vi.fn().mockResolvedValue(undefined) }))
    vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: loggerError, debug: vi.fn() } }))
    h.prior = [{ summary: 'A', answer: 'a', articleId: 11 }]

    const { generateAnswerCore } = await import('@/lib/agent/core')
    const res = await generateAnswerCore(7, { question: 'How do I reset my password?' })

    expect(recordAnswerReferences).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
    expect(JSON.stringify(res)).toContain('the answer')
    expect(loggerError).toHaveBeenCalledWith(
      'failed to record knowledge-base answer sources',
      expect.objectContaining({ orgId: 7, surface: 'agent_api' })
    )
  })

  it('also returns the same failure, and still throws the original error, when recording the failed outcome breaks', async () => {
    const recordAnswerReferences = vi.fn().mockRejectedValue(new Error('db down'))
    vi.resetModules()
    vi.doUnmock('@/lib/kb/usage')
    vi.doMock('@/lib/db/queries/kb-answers', () => ({ recordAnswerReferences }))
    vi.doMock('@/lib/db/queries/kb-usage', () => ({ recordArticleUsage: vi.fn() }))
    vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
    h.generate.mockRejectedValue(new Error('model exploded'))

    const { generateAnswerCore } = await import('@/lib/agent/core')
    await expect(generateAnswerCore(7, { question: 'q' })).rejects.toThrow('model exploded')
    expect(recordAnswerReferences).toHaveBeenCalledTimes(1)
  })
})
