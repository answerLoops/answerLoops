import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ARTICLE_USAGE_RETENTION_DAYS, ARTICLE_USAGE_WINDOW_DAYS } from '@/lib/kb/coverage'

// Runs the real query builders through drizzle's pg-proxy driver (no live
// Postgres) and checks the SQL and parameters they emit. The statements
// themselves were also run against a real Postgres when the table was added:
// the upsert increments, an article from another workspace is skipped, and the
// recent window excludes older days.

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

describe('recordArticleUsage', () => {
  it('does nothing, and runs no query, when there are no article ids', async () => {
    const { recordArticleUsage } = await import('@/lib/db/queries/kb-usage')

    await recordArticleUsage(7, [])

    expect(calls).toHaveLength(0)
  })

  it('upserts one row per article for today in UTC, adding to an existing count', async () => {
    const { recordArticleUsage } = await import('@/lib/db/queries/kb-usage')

    await recordArticleUsage(7, [11, 12])

    expect(calls).toHaveLength(1)
    const { sql, params } = calls[0]
    expect(sql).toContain('INSERT INTO kb_article_usage')
    expect(sql).toContain("(now() AT TIME ZONE 'utc')::date")
    expect(sql).toMatch(/ON CONFLICT \(article_id, day\) DO UPDATE SET answers = kb_article_usage\.answers \+ 1/)
    expect(params).toEqual(expect.arrayContaining([7, 11, 12]))
  })

  it('only counts articles that belong to the workspace', async () => {
    const { recordArticleUsage } = await import('@/lib/db/queries/kb-usage')

    await recordArticleUsage(7, [11])

    // The article ids are filtered through kb_articles by org, so an id from
    // another workspace never reaches the insert.
    expect(calls[0].sql).toMatch(/FROM kb_articles a\s+WHERE a\.org_id = \$\d+/)
  })

  it('counts an article once even when its id is listed several times', async () => {
    const { recordArticleUsage } = await import('@/lib/db/queries/kb-usage')

    await recordArticleUsage(7, [11, 11, 11, 12])

    const idParams = calls[0].params.filter((p) => p === 11)
    expect(idParams).toHaveLength(1)
  })

  it('ignores ids that are not whole numbers', async () => {
    const { recordArticleUsage } = await import('@/lib/db/queries/kb-usage')

    await recordArticleUsage(7, [Number.NaN, 1.5, 11])

    expect(calls[0].params).toEqual(expect.arrayContaining([11]))
    expect(calls[0].params).not.toContain(1.5)
    expect(calls[0].params.some((p) => Number.isNaN(p))).toBe(false)
  })
})

describe('getArticleUsage', () => {
  it('is scoped to the workspace and uses the requested window', async () => {
    responses.push([])
    const { getArticleUsage } = await import('@/lib/db/queries/kb-usage')

    await getArticleUsage(7, 14)

    expect(calls[0].sql).toContain('FROM kb_article_usage')
    expect(calls[0].sql).toMatch(/WHERE org_id = \$\d+/)
    expect(calls[0].params).toEqual(expect.arrayContaining([7, 14]))
  })

  it('defaults the recent window to 30 days', async () => {
    responses.push([])
    const { getArticleUsage } = await import('@/lib/db/queries/kb-usage')

    await getArticleUsage(7)

    expect(ARTICLE_USAGE_WINDOW_DAYS).toBe(30)
    expect(calls[0].params).toContain(30)
  })

  it('returns numbers even when the driver hands back strings', async () => {
    responses.push([
      { article_id: '11', total: '40', recent: '3' },
      { article_id: 12, total: 2, recent: 0 },
    ])
    const { getArticleUsage } = await import('@/lib/db/queries/kb-usage')

    expect(await getArticleUsage(7)).toEqual([
      { article_id: 11, total: 40, recent: 3 },
      { article_id: 12, total: 2, recent: 0 },
    ])
  })
})

describe('pruneArticleUsage', () => {
  it('deletes day rows older than the retention window and returns the count', async () => {
    responses.push([{ '?column?': 1 }, { '?column?': 1 }])
    const { pruneArticleUsage } = await import('@/lib/db/queries/kb-usage')

    expect(ARTICLE_USAGE_RETENTION_DAYS).toBe(400)
    expect(await pruneArticleUsage()).toBe(2)
    expect(calls[0].sql).toContain('DELETE FROM kb_article_usage')
    // Inclusive bound: a row dated exactly 400 days ago is pruned, so at most
    // 400 UTC days (today included) are kept.
    expect(calls[0].sql).toMatch(/day <= /)
    expect(calls[0].params).toContain(400)
  })

  it('rejects a non-positive retention instead of deleting everything', async () => {
    const { pruneArticleUsage } = await import('@/lib/db/queries/kb-usage')
    await expect(pruneArticleUsage(0)).rejects.toThrow()
    await expect(pruneArticleUsage(Number.NaN)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})
