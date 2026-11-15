import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * generate_answer retrieves knowledge-base answers, drafts from them, then
 * grades the draft. The grade only means "checked against your docs" if the
 * grading prompt actually contains those docs.
 */

const h = vi.hoisted(() => ({ generate: vi.fn(), getKBContext: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.getKBContext.mockResolvedValue([])

  vi.doMock('@mastra/core/agent', () => ({ Agent: class { generate = h.generate } }))
  vi.doMock('@/lib/ai/models', () => ({
    chatModel: async () => ({}),
    DEFAULT_CHAT_MODEL: 'default',
    DEFAULT_FAST_MODEL: 'fast',
    NoAIProviderConfiguredError: class extends Error {},
  }))
  vi.doMock('@/lib/ai/embed', () => ({ embedText: async () => [0.1] }))
  vi.doMock('@/lib/db/queries/kb', () => ({ searchArticles: vi.fn(), getKBContext: h.getKBContext }))
  vi.doMock('@/lib/db/queries/faq', () => ({ getLatestFAQ: vi.fn() }))
  vi.doMock('@/lib/db/queries/tickets', () => ({ getTickets: vi.fn(), encodeTicketCursor: vi.fn(), decodeTicketCursor: vi.fn() }))
  vi.doMock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: vi.fn() }))
  vi.doMock('@/lib/billing/usage', () => ({
    reserveGeneration: async () => ({ granted: true, generationId: 1 }),
    commitDeflection: async () => true,
  }))
  vi.doMock('@/lib/kb/usage', () => ({
    countArticleUsage: async () => undefined,
    newAnswerId: () => '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44',
    recordAnswerSources: async () => undefined,
  }))
  vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
})

async function run() {
  const { generateAnswerCore } = await import('@/lib/agent/core')
  return generateAnswerCore(7, { question: 'How do I reset my password?' })
}

describe('generate_answer grading step', () => {
  it('receives the knowledge-base answers the draft was written from', async () => {
    h.getKBContext.mockResolvedValue([
      { articleId: 1, summary: 'Reset password', answer: 'KB-FACT: use Settings, then Security.' },
    ])
    h.generate
      .mockResolvedValueOnce({ text: 'Use Settings, then Security.' })
      .mockResolvedValueOnce({ object: { confidence: 0.9, answered_fully: true, reasoning: 'ok' } })

    await run()

    const gradingPrompt = h.generate.mock.calls[1][0] as string
    expect(gradingPrompt).toContain('KB-FACT: use Settings, then Security.')
    expect(gradingPrompt).toContain('<reference_material>')
  })

  it('tells the grader no sources existed when retrieval found nothing', async () => {
    h.generate
      .mockResolvedValueOnce({ text: 'Open Settings.' })
      .mockResolvedValueOnce({ object: { confidence: 0.2, answered_fully: false, reasoning: 'unsupported' } })

    await run()

    const gradingPrompt = h.generate.mock.calls[1][0] as string
    expect(gradingPrompt).not.toContain('<reference_material>')
    expect(gradingPrompt).toMatch(/no reference material was available/i)
  })
})
