import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateText, streamText, embed } from 'ai'
import { MockLanguageModelV3, MockEmbeddingModelV3, simulateReadableStream } from 'ai/test'

// Every call a workspace makes on included platform AI usage is priced from
// the provider's reported usage and added to its spend. These drive the real
// AI SDK entry points (generateText/streamText/embed) through the wrapped
// model, so a middleware hook that never fires fails here.

const recordSpend = vi.fn()
const error = vi.fn()
const warn = vi.fn()
vi.mock('@/lib/billing/platform-ai-budget', () => ({ recordSpend: (...a: unknown[]) => recordSpend(...a) }))
vi.mock('@/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => error(...a), warn: (...a: unknown[]) => warn(...a), info: vi.fn(), debug: vi.fn() },
}))

import { meterLanguageModel, meterEmbeddingModel } from '@/lib/ai/metering'
import { costMicros } from '@/lib/ai/pricing'

const usage = (input?: number, cached?: number, output?: number) => ({
  inputTokens: { total: input === undefined ? undefined : input + (cached ?? 0), noCache: input, cacheRead: cached, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
})
const stop = { unified: 'stop' as const, raw: 'stop' }
const target = { orgId: 9, tier: 'plan' as const, modelId: 'gpt-5.6-luna' }

beforeEach(() => {
  recordSpend.mockReset().mockResolvedValue(undefined)
  error.mockReset()
  warn.mockReset()
})

describe('meterLanguageModel', () => {
  it('records one generate call at its priced cost', async () => {
    const inner = new MockLanguageModelV3({
      doGenerate: async () => ({ content: [{ type: 'text', text: 'hi' }], finishReason: stop, usage: usage(1000, 200, 50), warnings: [] }),
    })
    await generateText({ model: meterLanguageModel(inner, target), prompt: 'q' })
    expect(recordSpend).toHaveBeenCalledTimes(1)
    expect(recordSpend).toHaveBeenCalledWith(9, 'chat', 'plan', costMicros('gpt-5.6-luna', { input: 1000, cachedInput: 200, output: 50 }))
  })

  it('records a stream once, when its finish part arrives', async () => {
    const inner = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: 'hi' },
            { type: 'text-end', id: '1' },
            { type: 'finish', finishReason: stop, usage: usage(10, 0, 5) },
          ],
        }),
      }),
    })
    const r = streamText({ model: meterLanguageModel(inner, target), prompt: 'q' })
    await r.consumeStream()
    expect(recordSpend).toHaveBeenCalledTimes(1)
    expect(recordSpend).toHaveBeenCalledWith(9, 'chat', 'plan', costMicros('gpt-5.6-luna', { input: 10, cachedInput: 0, output: 5 }))
  })

  it('records nothing for a stream that errors before finish', async () => {
    const inner = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [{ type: 'error', error: new Error('boom') }] }),
      }),
    })
    const r = streamText({ model: meterLanguageModel(inner, target), prompt: 'q', onError: () => {} })
    await r.consumeStream()
    expect(recordSpend).not.toHaveBeenCalled()
  })

  it('estimates from text length when usage is missing, and warns', async () => {
    const inner = new MockLanguageModelV3({
      doGenerate: async () => ({ content: [{ type: 'text', text: 'abcdefgh' }], finishReason: stop, usage: usage(), warnings: [] }),
    })
    await generateText({ model: meterLanguageModel(inner, target), prompt: 'x'.repeat(400) })
    expect(recordSpend).toHaveBeenCalledTimes(1)
    expect(recordSpend.mock.calls[0][3]).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('estimated'), expect.objectContaining({ orgId: 9 }))
  })

  it('a failed spend write is logged and does not fail the call', async () => {
    recordSpend.mockRejectedValue(new Error('db down'))
    const inner = new MockLanguageModelV3({
      doGenerate: async () => ({ content: [{ type: 'text', text: 'ok' }], finishReason: stop, usage: usage(1, 0, 1), warnings: [] }),
    })
    const r = await generateText({ model: meterLanguageModel(inner, target), prompt: 'q' })
    expect(r.text).toBe('ok')
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
  })
})

describe('meterEmbeddingModel', () => {
  const embTarget = { orgId: 9, tier: 'trial' as const, modelId: 'text-embedding-3-small' }

  it('records the reported embedding tokens', async () => {
    const inner = new MockEmbeddingModelV3({ doEmbed: async () => ({ embeddings: [[0.1]], usage: { tokens: 123 }, warnings: [] }) })
    await embed({ model: meterEmbeddingModel(inner, embTarget), value: 'hello' })
    expect(recordSpend).toHaveBeenCalledWith(9, 'embedding', 'trial', costMicros('text-embedding-3-small', { input: 123, cachedInput: 0, output: 0 }))
  })

  it('estimates when usage is missing', async () => {
    const inner = new MockEmbeddingModelV3({ doEmbed: async () => ({ embeddings: [[0.1]], warnings: [] }) })
    await embed({ model: meterEmbeddingModel(inner, embTarget), value: 'x'.repeat(4_000_000) })
    expect(recordSpend.mock.calls[0][3]).toBe(costMicros('text-embedding-3-small', { input: 1_000_000, cachedInput: 0, output: 0 }))
  })
})
