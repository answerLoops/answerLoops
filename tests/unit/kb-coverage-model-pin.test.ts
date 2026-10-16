import { describe, it, expect, beforeEach, vi } from 'vitest'

// The coverage query decides "searchable" the way retrieval does: a vector made
// by the workspace's pinned embedding model.

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; params: unknown[] }> }))

vi.mock('@/lib/db/drizzle', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  const db = drizzle(async (sqlText: string, params: unknown[]) => {
    calls.push({ sql: sqlText, params })
    return { rows: [] }
  })
  return { getDb: () => db }
})

beforeEach(() => { calls.length = 0 })

describe('getKnowledgeCoverage', () => {
  it('treats an article as searchable only when its model is the workspace pin', async () => {
    const { getKnowledgeCoverage } = await import('@/lib/db/queries/kb-coverage')
    await getKnowledgeCoverage(7)
    const text = calls[0].sql.replace(/\s+/g, ' ')
    expect(text).toContain('"embedding_vec" IS NOT NULL')
    expect(text).toContain('"model" = (SELECT embedding_model_in_use FROM orgs WHERE id = $')
    expect(calls[0].params).toContain(7)
  })
})

describe('statusOf with a stale model', () => {
  it('shows a published article on another model as not_searchable, not live', async () => {
    const { statusOf } = await import('@/lib/kb/coverage')
    expect(statusOf({ published: 1, searchable: false })).toBe('not_searchable')
  })
})
