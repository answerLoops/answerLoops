import { describe, it, expect } from 'vitest'
import { embedMany } from 'ai'
import { mockEmbeddingModel, MOCK_EMBEDDING_DIMENSIONS } from '@/lib/ai/mock'
import { KB_EMBEDDING_DIMENSIONS } from '@/lib/ai/embed'

// kb_articles.embedding_vec is vector(1536). The mock embedding model backs
// every e2e/mock-mode KB write, and Postgres rejects an insert of any other
// width — so the mock must produce exactly KB_EMBEDDING_DIMENSIONS values.
describe('mock embedding model', () => {
  it('matches the platform KB embedding dimension', () => {
    expect(MOCK_EMBEDDING_DIMENSIONS).toBe(KB_EMBEDDING_DIMENSIONS)
  })

  it('returns vectors of exactly that length, unit-normalised', async () => {
    const { embeddings } = await embedMany({
      model: mockEmbeddingModel('mock-embed'),
      values: ['how do I reset my password', 'connect a telegram bot'],
    })
    for (const v of embeddings) {
      expect(v).toHaveLength(KB_EMBEDDING_DIMENSIONS)
      expect(Math.hypot(...v)).toBeCloseTo(1, 5)
    }
  })
})
