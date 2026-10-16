import { describe, it, expect, beforeEach, vi } from 'vitest'

// Gap ranking and the category summary, run through drizzle's pg-proxy driver
// with canned rows.

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

const gap = (id: number, category: string | null, confidence: number | null, reason: 'low_confidence' | 'needs_human' | 'no_kb_article' = 'low_confidence') => ({
  id, org_ticket_number: id, summary: `q${id}`, category, confidence, status: 'open',
  created_at: '2026-01-01', has_kb_article: false, gap_reason: reason,
})

describe('getKnowledgeGaps ranking', () => {
  it('ranks needs_human tickets ahead of the confidence ordering so a null confidence cannot push them out of the pool', async () => {
    responses.push([])
    const { getKnowledgeGaps } = await import('@/lib/db/queries/analytics')
    await getKnowledgeGaps(200, 7)
    const order = calls[0].sql.slice(calls[0].sql.indexOf('ORDER BY'))
    expect(order.replace(/\s+/g, ' ')).toMatch(
      /ORDER BY \(t\.ai_draft_status = 'needs_human'\) DESC, a\.confidence ASC NULLS LAST/
    )
  })
})

describe('getGapTicketTotals', () => {
  const row = (category: string, gap_reason: string, count: number, conf_n: number, conf_sum: number) => ({
    category, gap_reason, count, conf_n, conf_sum,
  })

  it('aggregates over all open gap tickets in SQL with no row limit', async () => {
    responses.push([])
    const { getGapTicketTotals } = await import('@/lib/db/queries/analytics')
    await getGapTicketTotals(7)
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).not.toMatch(/\bLIMIT\b/i)
    expect(calls[0].sql).toMatch(/GROUP BY/i)
    expect(calls[0].sql).toContain(`'duplicate'`)
  })

  it('derives the cards and the category breakdown from the same rows so they agree', async () => {
    responses.push([
      row('how_to', 'needs_human', 300, 0, 0),
      row('how_to', 'low_confidence', 100, 100, 20),
      row('bug', 'low_confidence', 50, 50, 25),
      row('uncategorized', 'no_kb_article', 10, 0, 0),
    ])
    const { getGapTicketTotals } = await import('@/lib/db/queries/analytics')
    const t = await getGapTicketTotals(7)
    expect(t.total).toBe(460)
    expect(t.needs_human).toBe(300)
    expect(t.low_confidence).toBe(150)
    expect(t.no_kb_article).toBe(10)
    expect(t.needs_human + t.low_confidence + t.no_kb_article).toBe(t.total)
    expect(t.categories.reduce((n, c) => n + c.count, 0)).toBe(t.total)
    expect(t.categories).toEqual([
      { category: 'how_to', count: 400, avg_confidence: 0.2 },
      { category: 'bug', count: 50, avg_confidence: 0.5 },
      { category: 'uncategorized', count: 10, avg_confidence: null },
    ])
  })

  it('getGapCategorySummary returns the same category breakdown', async () => {
    responses.push([row('bug', 'low_confidence', 3, 3, 0.9)])
    const { getGapCategorySummary } = await import('@/lib/db/queries/analytics')
    const summary = await getGapCategorySummary(7)
    expect(summary).toHaveLength(1)
    expect(summary[0].category).toBe('bug')
    expect(summary[0].count).toBe(3)
    expect(summary[0].avg_confidence).toBeCloseTo(0.3)
  })
})
