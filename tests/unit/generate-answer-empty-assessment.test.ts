import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * generate_answer (the Agent API and MCP path), run for real with the real
 * assessAnswer on top of a faked agent library: when the grading step gets
 * nothing usable back from the model, the caller must still get the answer,
 * marked unconfident, and the call must not bill as a deflection.
 *
 * The agent library resolves an empty completion with `object: undefined`
 * instead of throwing. Before assessAnswer rejected on that, the undefined
 * assessment skipped the .catch in generateAnswerCore and shouldAutoDeflect
 * threw a TypeError out of the call, which the REST route returns as a 500.
 */

const h = vi.hoisted(() => ({
  generate: vi.fn(),
  commitDeflection: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.commitDeflection.mockResolvedValue(true)

  vi.doMock('@mastra/core/agent', () => ({ Agent: class { generate = h.generate } }))
  vi.doMock('@/lib/ai/models', () => ({
    chatModel: async () => ({}),
    DEFAULT_CHAT_MODEL: 'default',
    DEFAULT_FAST_MODEL: 'fast',
    NoAIProviderConfiguredError: class extends Error {},
  }))
  vi.doMock('@/lib/ai/embed', () => ({ embedText: async () => [0.1] }))
  vi.doMock('@/lib/db/queries/kb', () => ({ searchArticles: vi.fn(), getKBContext: async () => [] }))
  vi.doMock('@/lib/db/queries/faq', () => ({ getLatestFAQ: vi.fn() }))
  vi.doMock('@/lib/db/queries/tickets', () => ({ getTickets: vi.fn(), encodeTicketCursor: vi.fn(), decodeTicketCursor: vi.fn() }))
  vi.doMock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: vi.fn() }))
  vi.doMock('@/lib/billing/usage', () => ({
    reserveGeneration: async () => ({ granted: true, generationId: 1 }),
    commitDeflection: h.commitDeflection,
  }))
  vi.doMock('@/lib/kb/usage', () => ({
    countArticleUsage: async () => undefined,
    newAnswerId: () => '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44',
    recordAnswerSources: async () => undefined,
  }))
  vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
})

async function generate() {
  const { generateAnswerCore } = await import('@/lib/agent/core')
  return generateAnswerCore(7, { question: 'How do I reset my password?' })
}

describe('generate_answer when the assessment comes back empty', () => {
  it.each([undefined, null])('returns the answer with zero confidence and no deflection when the model returned %s', async (empty) => {
    h.generate
      .mockResolvedValueOnce({ text: 'Open Settings, then Security.' }) // the answer
      .mockResolvedValueOnce({ object: empty }) //                        the grading step

    const res = await generate()

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data).toEqual({
      answer: 'Open Settings, then Security.',
      confidence: 0,
      answered_fully: false,
      high_confidence: false,
    })
    expect(h.commitDeflection).not.toHaveBeenCalled()
  })

  it('still bills a confident, fully answered call as a deflection', async () => {
    h.generate
      .mockResolvedValueOnce({ text: 'Open Settings, then Security.' })
      .mockResolvedValueOnce({ object: { confidence: 0.9, answered_fully: true, reasoning: 'ok' } })

    const res = await generate()

    expect(res.ok && res.data.high_confidence).toBe(true)
    expect(h.commitDeflection).toHaveBeenCalledWith(7, 1)
  })
})
