import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Name-for-name parity between migrations 0056/0057 and lib/db/schema.ts, plus
// the shape rules the migration runner relies on (statement breakpoints,
// idempotent statements). File-system assertions only; no database needed.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const migration = (prefix: string) => {
  const f = fs.readdirSync(path.join(ROOT, 'drizzle')).find((n) => n.startsWith(prefix) && n.endsWith('.sql'))
  expect(f, `migration ${prefix} exists`).toBeDefined()
  return read(`drizzle/${f}`)
}
const schema = read('lib/db/schema.ts')

/** Statements the runner executes: split on the breakpoint marker, comments stripped. */
function statements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
}

/** Body of one pgTable(...) declaration. */
function tableBlock(table: string): string {
  const start = schema.indexOf(`pgTable(\n  '${table}'`) >= 0 ? schema.indexOf(`pgTable(\n  '${table}'`) : schema.indexOf(`pgTable('${table}'`)
  expect(start, `${table} declared in schema`).toBeGreaterThan(-1)
  const next = schema.indexOf('\nexport const ', start)
  return schema.slice(start, next === -1 ? undefined : next)
}

describe('migration 0056 shape', () => {
  const sql = migration('0056_')
  const stmts = statements(sql)

  it('every statement is idempotent', () => {
    expect(stmts.length).toBeGreaterThan(0)
    for (const s of stmts) {
      if (/^UPDATE /i.test(s)) continue // guarded by IS NULL, re-runnable
      expect(s).toMatch(/IF NOT EXISTS|IF EXISTS/)
    }
  })

  it('the breakpoint count matches the statement count', () => {
    expect(sql.match(/--> statement-breakpoint/g)).toHaveLength(stmts.length - 1)
  })

  it('the heartbeat backfill only touches running jobs that have no heartbeat yet', () => {
    const update = stmts.find((s) => /^UPDATE kb_sync_jobs/i.test(s))!
    expect(update).toContain("status = 'running'")
    expect(update).toContain('heartbeat_at IS NULL')
  })

  it('the index is dropped before it is recreated with org_id leading the column list', () => {
    const drop = stmts.findIndex((s) => /^DROP INDEX IF EXISTS kb_sync_jobs_one_active/.test(s))
    const create = stmts.findIndex((s) => /^CREATE UNIQUE INDEX IF NOT EXISTS kb_sync_jobs_one_active/.test(s))
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
    expect(stmts[create]).toMatch(/\(org_id, kind, COALESCE\(repo_id, 0\)\)/)
    expect(stmts[create]).toMatch(/WHERE status IN \('queued', 'running'\)/)
  })
})

describe('migration 0057 shape', () => {
  const sql = migration('0057_')
  const stmts = statements(sql)

  it('has exactly the three expected idempotent statements', () => {
    expect(stmts).toHaveLength(3)
    for (const s of stmts) expect(s).toMatch(/IF NOT EXISTS/)
  })

  it('every breakpoint sits between two statements, never trailing or doubled', () => {
    expect(sql.match(/--> statement-breakpoint/g)).toHaveLength(stmts.length - 1)
    expect(sql).not.toMatch(/--> statement-breakpoint\s*--> statement-breakpoint/)
    expect(sql.trimEnd().endsWith('statement-breakpoint')).toBe(false)
  })

  it('no statement shares a line with a breakpoint (a split would otherwise join them)', () => {
    for (const line of sql.split('\n')) {
      if (line.includes('--> statement-breakpoint')) expect(line.trim()).toBe('--> statement-breakpoint')
    }
  })
})

describe('schema parity with migration 0056', () => {
  const sql = migration('0056_')
  const jobs = tableBlock('kb_sync_jobs')

  it('every column the migration adds to kb_sync_jobs is declared in the schema by the same name', () => {
    const cols = [...sql.matchAll(/ALTER TABLE kb_sync_jobs ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1])
    expect(cols.sort()).toEqual(['heartbeat_at', 'not_before', 'rerun_requested'])
    for (const c of cols) expect(jobs).toContain(`'${c}'`)
  })

  it('the schema declares the one-active index under the migration index name, with org_id first', () => {
    const name = sql.match(/CREATE UNIQUE INDEX IF NOT EXISTS (\w+)/)![1]
    expect(jobs).toMatch(new RegExp(`uniqueIndex\\('${name}'\\)\\s*\\.on\\(t\\.orgId, t\\.kind, sql\`COALESCE\\(\\$\\{t\\.repoId\\}, 0\\)\`\\)`))
    expect(jobs).toMatch(/\.where\(sql`[^`]*status IN \('queued', 'running'\)/)
  })

  it('the non-null flag defaults to false on both sides', () => {
    expect(sql).toContain('rerun_requested boolean NOT NULL DEFAULT false')
    expect(jobs).toMatch(/rerunRequested: boolean\('rerun_requested'\)\.notNull\(\)\.default\(false\)/)
  })

  it('the staged-hash columns are used by the re-index code under the migration column names', () => {
    const cols = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS (\w+_hash) text/g)].map((m) => m[1])
    expect(cols.sort()).toEqual(['embedding_next_hash', 'vector_next_hash'])
    const reindex = read('lib/kb/embedding-migration.ts')
    for (const c of cols) expect(reindex).toContain(c)
  })
})

describe('schema parity with migration 0057', () => {
  const sql = migration('0057_')

  it('kb_review_items declares merge_day and merge_day_count as the migration does', () => {
    const block = tableBlock('kb_review_items')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS merge_day DATE')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS merge_day_count INTEGER NOT NULL DEFAULT 0')
    expect(block).toContain("date('merge_day')")
    expect(block).toMatch(/integer\('merge_day_count'\)\.notNull\(\)\.default\(0\)/)
  })

  it('kb_articles declares the (org_id, published) index under the migration index name', () => {
    const name = sql.match(/CREATE INDEX IF NOT EXISTS (\w+) ON kb_articles \(org_id, published\)/)![1]
    expect(name).toBe('idx_kb_articles_org_published')
    expect(tableBlock('kb_articles')).toMatch(new RegExp(`index\\('${name}'\\)\\.on\\(t\\.orgId, t\\.published\\)`))
  })
})
