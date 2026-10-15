import { describe, it, expect, beforeEach, vi } from 'vitest'

// Runs the real query through drizzle's pg-proxy driver (no live Postgres) with
// canned rows, to check the wiring: gaps are loaded, their stored vectors are
// read only for the workspace's pinned embedding model, and repeats are folded.

type Call = { sql: string; params: unknown[] }
const { calls, responses } = vi.hoisted(() => ({
  calls: [] as Call[],
  responses: [] as Array<Array<Record<string, unknown>>>,
}))

vi.mock('@/lib/db/drizzle', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  const db = drizzle(async (sqlText: string, params: unknown[]) => {
    calls.push({ sql: sqlText, params })
    return { rows: responses.shift() ?? [] }
  })
  return { getDb: () => db }
})

beforeEach(() => {
  calls.length = 0
  responses.length = 0
})

const gapRow = (id: number, confidence: number) => ({
  id,
  org_ticket_number: id,
  summary: `question ${id}`,
  category: 'how_to',
  confidence,
  status: 'open',
  created_at: '2026-01-01',
  has_kb_article: false,
  gap_reason: 'low_confidence',
})

describe('getKnowledgeGapClusters', () => {
  it('returns nothing and skips the vector read when there are no gaps', async () => {
    responses.push([])
    const { getKnowledgeGapClusters } = await import('@/lib/db/queries/analytics')

    expect(await getKnowledgeGapClusters(50, 7)).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('folds repeated questions and ranks the most-asked first', async () => {
    responses.push([gapRow(1, 0.1), gapRow(2, 0.2), gapRow(3, 0.3)])
    responses.push([
      { ticket_id: 1, vector: JSON.stringify([1, 0]) },
      { ticket_id: 2, vector: JSON.stringify([0, 1]) },
      { ticket_id: 3, vector: JSON.stringify([0, 1]) },
    ])
    const { getKnowledgeGapClusters } = await import('@/lib/db/queries/analytics')

    const clusters = await getKnowledgeGapClusters(50, 7)

    expect(clusters.map((c) => [c.lead.id, c.count])).toEqual([[2, 2], [1, 1]])
  })

  it('reads vectors only for the workspace embedding model', async () => {
    responses.push([gapRow(1, 0.1)])
    responses.push([])
    const { getKnowledgeGapClusters } = await import('@/lib/db/queries/analytics')

    await getKnowledgeGapClusters(50, 7)

    const vectorQuery = calls[1]
    expect(vectorQuery.sql).toContain('FROM ticket_embeddings')
    expect(vectorQuery.sql).toContain('embedding_model_in_use')
    // Only the ranked gap tickets are looked up, as bound parameters.
    expect(vectorQuery.params).toEqual(expect.arrayContaining([1, 7]))
  })

  it('keeps a ticket with a corrupt vector as its own entry instead of failing', async () => {
    responses.push([gapRow(1, 0.1), gapRow(2, 0.2)])
    responses.push([
      { ticket_id: 1, vector: JSON.stringify([1, 0]) },
      { ticket_id: 2, vector: 'not json' },
    ])
    const { getKnowledgeGapClusters } = await import('@/lib/db/queries/analytics')

    const clusters = await getKnowledgeGapClusters(50, 7)

    expect(clusters).toHaveLength(2)
  })

  it('caps the number of clusters returned', async () => {
    responses.push([gapRow(1, 0.1), gapRow(2, 0.2), gapRow(3, 0.3)])
    responses.push([])
    const { getKnowledgeGapClusters } = await import('@/lib/db/queries/analytics')

    expect(await getKnowledgeGapClusters(2, 7)).toHaveLength(2)
  })
})
