import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import fs from 'fs'
import path from 'path'

/**
 * lib/db/queries/kb.ts retrieval helpers driven through drizzle's pg-proxy
 * driver: real compiled SQL, scripted rows, no database.
 */

type Call = { sql: string; params: unknown[] }
let calls: Call[]
let failing: RegExp | null
let extversion: string | null

function install() {
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    const text = sqlText.replace(/\s+/g, ' ').trim().toLowerCase()
    calls.push({ sql: text, params })
    if (failing && failing.test(text)) throw new Error('unrecognized configuration parameter')
    if (text.includes('pg_extension')) return { rows: extversion === null ? [] : [{ extversion }] }
    return { rows: [] }
  })
  const withTx = Object.assign(Object.create(fakeDb), {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      calls.push({ sql: 'begin', params: [] })
      try {
        const out = await fn(withTx)
        calls.push({ sql: 'commit', params: [] })
        return out
      } catch (e) {
        calls.push({ sql: 'rollback', params: [] })
        throw e
      }
    },
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => withTx }))
  vi.resetModules()
}

beforeEach(() => {
  calls = []
  failing = null
  extversion = '0.8.0'
  install()
})

describe('searchArticles', () => {
  const setConfig = () => calls.filter((c) => c.sql.includes('set_config'))

  it('sets ef_search and strict_order in one statement inside the transaction, before the query', async () => {
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await searchArticles([0.1, 0.2], 5, 3)
    const order = calls.map((c) => c.sql)
    const cfg = order.findIndex((q) => q.includes('set_config'))
    const select = order.findIndex((q) => q.startsWith('select') && !q.includes('set_config') && !q.includes('pg_extension'))
    expect(order.indexOf('begin')).toBeGreaterThan(order.findIndex((q) => q.includes('pg_extension')))
    expect(order[order.indexOf('begin') + 1]).toContain('set_config')
    expect(setConfig()).toHaveLength(1)
    expect(cfg).toBeGreaterThan(0)
    expect(select).toBeGreaterThan(cfg)
    expect(order[order.length - 1]).toBe('commit')
    const stmt = setConfig()[0]
    expect(stmt.sql).toContain("'hnsw.ef_search'")
    expect(stmt.sql).toContain("'hnsw.iterative_scan'")
    expect(stmt.sql).toMatch(/, true\)/)
    expect(stmt.params).toContain('200')
    expect(stmt.sql).not.toContain('relaxed_order')
    expect(calls.some((c) => c.sql.includes('savepoint') || c.sql.includes('set local'))).toBe(false)
  })

  it('uses strict ordering, never relaxed, when iterative scans are supported', async () => {
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await searchArticles([0.1], 5, 3)
    const all = JSON.stringify(calls)
    expect(all).toContain('strict_order')
    expect(all).not.toContain('relaxed_order')
  })

  it('accepts newer pgvector versions', async () => {
    extversion = '0.10.1'
    install()
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await searchArticles([0.1], 5, 3)
    expect(setConfig()[0].sql).toContain('hnsw.iterative_scan')
  })

  it('sets only ef_search on a pgvector build older than 0.8', async () => {
    extversion = '0.7.4'
    install()
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await expect(searchArticles([0.1], 5, 3)).resolves.toEqual([])
    expect(setConfig()).toHaveLength(1)
    expect(setConfig()[0].sql).toContain('hnsw.ef_search')
    expect(setConfig()[0].sql).not.toContain('iterative_scan')
    expect(JSON.stringify(calls)).not.toContain('strict_order')
    expect(JSON.stringify(calls)).not.toContain('relaxed_order')
  })

  it('treats a missing extension row as unsupported', async () => {
    extversion = null
    install()
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await searchArticles([0.1], 5, 3)
    expect(setConfig()[0].sql).not.toContain('iterative_scan')
  })

  it('treats a failed version lookup as unsupported and still searches', async () => {
    failing = /pg_extension/
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await expect(searchArticles([0.1], 5, 3)).resolves.toEqual([])
    expect(setConfig()).toHaveLength(1)
    expect(setConfig()[0].sql).not.toContain('iterative_scan')
    expect(calls[calls.length - 1].sql).toBe('commit')
  })

  it('looks up pgvector support once per process', async () => {
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await searchArticles([0.1], 5, 3)
    await searchArticles([0.1], 5, 3)
    await searchArticles([0.1], 5, 3)
    expect(calls.filter((c) => c.sql.includes('pg_extension'))).toHaveLength(1)
    expect(setConfig()).toHaveLength(3)
  })

  it('compares versions numerically', async () => {
    const { isIterativeScanVersion } = await import('@/lib/db/queries/kb')
    expect(isIterativeScanVersion('0.8.0')).toBe(true)
    expect(isIterativeScanVersion('0.10.0')).toBe(true)
    expect(isIterativeScanVersion('1.0.0')).toBe(true)
    expect(isIterativeScanVersion('0.7.9')).toBe(false)
    expect(isIterativeScanVersion('garbage')).toBe(false)
  })

  it('keeps the org, published and pinned-model filters', async () => {
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await searchArticles([0.1], 5, 3)
    const q = calls.find((c) => c.sql.startsWith('select') && c.sql.includes('"kb_articles"'))!
    expect(q.sql).toContain('"org_id" = $')
    expect(q.sql).toContain('"published" = $')
    expect(q.sql).toContain('embedding_model_in_use')
  })
})

describe('textSearchArticles', () => {
  it('matches case-insensitively', async () => {
    const { textSearchArticles } = await import('@/lib/db/queries/kb')
    await textSearchArticles('Reset', 5, 3)
    const q = calls.find((c) => c.sql.startsWith('select'))!
    expect(q.sql).toContain('ilike')
    expect(q.sql).not.toMatch(/ like /)
  })

  it('treats percent, underscore and backslash in the query as literal text', async () => {
    const { textSearchArticles, escapeLikePattern } = await import('@/lib/db/queries/kb')
    expect(escapeLikePattern('100%_a\\b')).toBe('100\\%\\_a\\\\b')
    await textSearchArticles('50%_off', 5, 3)
    const q = calls.find((c) => c.sql.startsWith('select'))!
    expect(q.params).toContain('%50\\%\\_off%')
  })
})

describe('migration 0057', () => {
  const file = fs.readdirSync(path.join(process.cwd(), 'drizzle')).find((f) => f.startsWith('0057_'))!
  const sqlText = fs.readFileSync(path.join(process.cwd(), 'drizzle', file), 'utf8')

  it('adds the org and published index idempotently', () => {
    expect(sqlText).toMatch(/CREATE INDEX IF NOT EXISTS idx_kb_articles_org_published ON kb_articles \(org_id, published\)/)
  })

  it('adds the review counters idempotently', () => {
    expect(sqlText).toMatch(/ADD COLUMN IF NOT EXISTS merge_day DATE/)
    expect(sqlText).toMatch(/ADD COLUMN IF NOT EXISTS merge_day_count INTEGER NOT NULL DEFAULT 0/)
  })

  it('separates statements with the breakpoint marker the runner splits on', () => {
    expect(sqlText.match(/--> statement-breakpoint/g)).toHaveLength(2)
  })
})
