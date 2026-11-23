import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableColumns } from 'drizzle-orm'
import { kbArticles } from '@/lib/db/schema'
import { widgetContextBlock } from '@/lib/widget/instructions'

/**
 * The website widget's retrieval: strong matches when there are any, otherwise
 * the closest near misses above a lower floor, so a loosely worded question
 * ("what does it cost?") still reaches the article that answers it. Real SQL
 * through drizzle's pg-proxy driver, with the database's rows scripted.
 */

type Call = { sql: string; params: unknown[] }
let calls: Call[]
let rows: unknown[][]

const cols = Object.values(getTableColumns(kbArticles))
// A full kb_articles row as the driver returns it (positional), plus the distance column.
const row = (id: number, question: string, answer: string, distance: number): unknown[] => [
  ...cols.map((col) =>
    col.name === 'id'
      ? id
      : col.name === 'question'
        ? question
        : col.name === 'answer'
          ? answer
          : col.columnType === 'PgVector'
            ? '[0.1,0.2]'
            : col.dataType === 'number'
              ? 1
              : 'x'
  ),
  distance,
]

beforeEach(() => {
  calls = []
  rows = []
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    const call = { sql: sqlText.replace(/\s+/g, ' ').trim().toLowerCase(), params }
    calls.push(call)
    if (call.sql.includes('pg_extension')) return { rows: [['0.8.0']] }
    if (call.sql.includes('set_config')) return { rows: [] }
    return { rows }
  })
  const db = Object.assign(Object.create(fakeDb), {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
  vi.resetModules()
})

const searchCall = () => calls.find((c) => c.sql.includes('from "kb_articles"') && c.sql.includes('limit'))!

describe('searchArticles match bar', () => {
  it('keeps the 0.45 bar for every caller that does not ask for less', async () => {
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await searchArticles([0.1, 0.2], 3, 3)
    expect(searchCall().params).toContain(0.55)
  })

  it('searches down to the near-miss floor for the widget', async () => {
    const { getWidgetKBContext, KB_NEAR_MISS_FLOOR } = await import('@/lib/db/queries/kb')
    await getWidgetKBContext([0.1, 0.2], 5, 3)
    expect(searchCall().params).toContain(1 - KB_NEAR_MISS_FLOOR)
  })
})

describe('getWidgetKBContext', () => {
  it('returns only the strong matches when any article clears the bar, exactly as before', async () => {
    rows = [row(1, 'Pricing › Pro', '$49 a month.', 0.3), row(2, 'Pricing › Team', '$149 a month.', 0.6)]
    const { getWidgetKBContext } = await import('@/lib/db/queries/kb')
    const ctx = await getWidgetKBContext([0.1, 0.2], 5, 3)
    expect(ctx.matched).toBe(true)
    expect(ctx.articles).toEqual([{ summary: 'Pricing › Pro', answer: '$49 a month.', articleId: 1 }])
  })

  it('falls back to the near misses, closest first, when nothing clears the bar', async () => {
    rows = [row(1, 'Pricing › Pro', '$49 a month.', 0.6), row(2, 'Pricing › Team', '$149 a month.', 0.65)]
    const { getWidgetKBContext } = await import('@/lib/db/queries/kb')
    const ctx = await getWidgetKBContext([0.1, 0.2], 5, 3)
    expect(ctx.matched).toBe(false)
    expect(ctx.articles.map((a) => a.articleId)).toEqual([1, 2])
  })

  it('returns nothing, unmatched, when nothing comes close', async () => {
    const { getWidgetKBContext } = await import('@/lib/db/queries/kb')
    expect(await getWidgetKBContext([0.1, 0.2], 5, 3)).toEqual({ articles: [], matched: false })
  })
})

describe('widgetContextBlock', () => {
  const articles = [{ summary: 'Pricing › Pro', answer: '$49 a month.' }]

  it('is empty when there are no articles', () => {
    expect(widgetContextBlock({ articles: [], matched: false })).toBe('')
  })

  it('keeps the wording a matched answer has always had', () => {
    const block = widgetContextBlock({ articles, matched: true })
    expect(block.startsWith('\n\nKnowledge base context — use this to answer. ')).toBe(true)
    expect(block).toContain('$49 a month.')
    expect(block).not.toContain('closest ones found')
  })

  it('tells the model near misses may not cover the question, and to answer from them only if they do', () => {
    const block = widgetContextBlock({ articles, matched: false })
    expect(block).toContain('closest ones found')
    expect(block).toContain('if none of them do, treat the question as not covered')
    expect(block).toContain('$49 a month.')
  })
})
