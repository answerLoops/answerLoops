import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ generateText: vi.fn(), embed: vi.fn() }))
vi.mock('ai', () => ({ generateText: h.generateText, embed: h.embed }))
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/ai/models', () => ({
  buildChatProvider: () => (id: string) => ({ id }),
  buildEmbeddingModel: (id: string) => ({ id }),
}))

import { testAIProviderConnection } from '@/lib/ai/test-connection'

const input = {
  chatProvider: 'anthropic',
  chatModel: 'claude-x',
  chatApiKey: 'sk-ant',
  chatBaseUrl: null,
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  embeddingApiKey: 'sk-oai',
  embeddingBaseUrl: null,
}

beforeEach(() => vi.clearAllMocks())

describe('testAIProviderConnection', () => {
  it('reports both OK when the tiny calls succeed', async () => {
    h.generateText.mockResolvedValue({ text: 'ok' })
    h.embed.mockResolvedValue({ embedding: [0.1] })
    const res = await testAIProviderConnection(input)
    expect(res).toEqual({ chat: { ok: true }, embedding: { ok: true } })
    // chat call is genuinely tiny
    expect(h.generateText).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: expect.any(Number) }))
  })

  it('maps a 401 to an actionable message and isolates chat vs embedding', async () => {
    h.generateText.mockRejectedValue(new Error('AI_APICallError: 401 Incorrect API key provided'))
    h.embed.mockResolvedValue({ embedding: [0.1] })
    const res = await testAIProviderConnection(input)
    expect(res.chat.ok).toBe(false)
    expect(res.chat.error).toMatch(/rejected \(401\)/)
    expect(res.embedding).toEqual({ ok: true })
  })

  it('maps a 404 model error and a network error', async () => {
    h.generateText.mockRejectedValue(new Error('404 the model `claude-x` does not exist'))
    h.embed.mockRejectedValue(new Error('fetch failed ECONNREFUSED'))
    const res = await testAIProviderConnection(input)
    expect(res.chat.error).toMatch(/model ID was not found/)
    expect(res.embedding.error).toMatch(/Could not reach the endpoint/)
  })

  it('short-circuits to OK under MOCK_EXTERNALS', async () => {
    vi.resetModules()
    vi.doMock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: true }))
    const { testAIProviderConnection: mocked } = await import('@/lib/ai/test-connection')
    expect(await mocked(input)).toEqual({ chat: { ok: true }, embedding: { ok: true } })
    expect(h.generateText).not.toHaveBeenCalled()
    vi.doUnmock('@/lib/mock-mode')
  })
})
