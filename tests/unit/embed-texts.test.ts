import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  embedMany: vi.fn(),
  embed: vi.fn(),
  resolveEmbedding: vi.fn(),
}))

vi.mock('ai', () => ({ embed: h.embed, embedMany: h.embedMany }))
vi.mock('@/lib/ai/models', () => ({
  resolveEmbedding: h.resolveEmbedding,
  embeddingModel: vi.fn(),
  DEFAULT_EMBEDDING_MODEL: 'text-embedding-3-small',
}))

import { embedTexts } from '@/lib/ai/embed'

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveEmbedding.mockResolvedValue({ model: 'model-handle', modelId: 'text-embedding-3-small' })
})

describe('embedTexts', () => {
  it('embeds all the texts in one call, on the workspace model, and reports the tokens billed', async () => {
    h.embedMany.mockResolvedValue({ embeddings: [[1, 0], [0, 1]], usage: { tokens: 42 } })
    const out = await embedTexts(['a', 'b'], 7)
    expect(h.resolveEmbedding).toHaveBeenCalledWith('text-embedding-3-small', 7)
    expect(h.embedMany).toHaveBeenCalledExactlyOnceWith({ model: 'model-handle', values: ['a', 'b'] })
    expect(out).toEqual({ embeddings: [[1, 0], [0, 1]], tokens: 42, model: 'text-embedding-3-small' })
  })

  it('reports zero tokens when the provider does not say, instead of inventing a count', async () => {
    h.embedMany.mockResolvedValue({ embeddings: [[1]], usage: undefined })
    expect((await embedTexts(['a'])).tokens).toBe(0)
  })

  it('lets a provider failure propagate to the caller', async () => {
    h.embedMany.mockRejectedValue(new Error('quota'))
    await expect(embedTexts(['a'], 1)).rejects.toThrow('quota')
  })

  it('does not store anything: it only calls the model', async () => {
    h.embedMany.mockResolvedValue({ embeddings: [[1]], usage: { tokens: 1 } })
    await embedTexts(['a'])
    expect(h.embed).not.toHaveBeenCalled()
  })
})
