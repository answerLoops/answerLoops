import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { kbArticleUsage } from '@/lib/db/schema'

// Guards the parts of the kb_article_usage change that only fail at deploy
// time: how the migration runner picks up and applies the file, whether the SQL
// and the Drizzle table definition agree, and the order of the workspace purge.

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0055_kb_article_usage.sql'

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8')
}
function sqlStatements(): string {
  return read(`drizzle/${MIGRATION}`)
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
}

describe('migration file ordering (lib/db/migrate.ts runs *.sql sorted by name)', () => {
  const files = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql')).sort()

  it('runs the usage migration after the embedding lease migration it follows', () => {
    const prev = files.find((f) => f.startsWith('0054_'))
    expect(prev).toBeDefined()
    expect(files.indexOf(MIGRATION)).toBeGreaterThan(files.indexOf(prev!))
  })

  it('runs after the tables it references are created', () => {
    const creator = (table: string) =>
      files.findIndex((f) => new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?${table}"?[ (]`).test(read(`drizzle/${f}`)))
    for (const t of ['kb_articles', 'orgs']) {
      const i = creator(t)
      expect(i, `no migration creates ${t}`).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(files.indexOf(MIGRATION))
    }
  })

  it('no two migrations share a numeric prefix', () => {
    const seen = new Map<string, string>()
    for (const f of files) {
      const prefix = f.split('_')[0]
      expect(prefix, `${f} has no numeric prefix`).toMatch(/^\d{4}$/)
      expect(seen.get(prefix), `${f} collides with ${seen.get(prefix)}`).toBeUndefined()
      seen.set(prefix, f)
    }
  })

  it('is safe to re-run: every CREATE is IF NOT EXISTS and nothing else mutates data or schema', () => {
    const s = sqlStatements()
    const creates = s.match(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\b[^;]*/gi) ?? []
    expect(creates.length).toBe(2)
    for (const c of creates) expect(c).toMatch(/\b(TABLE|INDEX)\s+IF NOT EXISTS\b/i)
    // The runner only skips "already exists" codes; anything else would abort a re-run.
    expect(s.replace(/ON DELETE CASCADE/gi, '')).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
  })
})

describe('row-level security reaches the new table without its own statement', () => {
  it('the runner enables RLS on every public table, and the migration does not need to', () => {
    const runner = read('lib/db/migrate.ts')
    expect(runner).toMatch(/schemaname = 'public' AND NOT rowsecurity/)
    expect(runner).toContain("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY")
    // Runs after the migration files are applied, not before.
    expect(runner.indexOf('ENABLE ROW LEVEL SECURITY')).toBeGreaterThan(runner.indexOf('.sort()'))
  })
})

describe('Drizzle table agrees with the SQL migration', () => {
  const cfg = getTableConfig(kbArticleUsage)
  const s = sqlStatements()
  const body = s.slice(s.indexOf('(') + 1, s.indexOf(');'))
  const colLines = body
    .split('\n')
    .map((l) => l.trim().replace(/,$/, ''))
    .filter((l) => l && !l.startsWith('PRIMARY KEY'))
  const sqlCols = new Map(colLines.map((l) => [l.split(/\s+/)[0], l]))

  it('declares the same columns', () => {
    expect([...sqlCols.keys()].sort()).toEqual(cfg.columns.map((c) => c.name).sort())
  })

  it('matches type, nullability and default per column', () => {
    const family: Record<string, string> = { integer: 'INTEGER', date: 'DATE' }
    for (const col of cfg.columns) {
      const line = sqlCols.get(col.name)!
      expect(line, col.name).toContain(family[col.getSQLType()])
      expect(/\bNOT NULL\b/.test(line), `${col.name} nullability`).toBe(col.notNull)
      const def = line.match(/\bDEFAULT\s+(\S+)/)
      expect(def ? def[1] : undefined, `${col.name} default`).toBe(col.hasDefault ? String(col.default) : undefined)
    }
  })

  it('cascades deletes from the same parent tables', () => {
    expect(cfg.foreignKeys.length).toBe(2)
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference()
      expect(fk.onDelete).toBe('cascade')
      const col = ref.columns[0].name
      const line = sqlCols.get(col)!
      expect(line).toContain(`REFERENCES ${getTableConfig(ref.foreignTable).name}(${ref.foreignColumns[0].name}) ON DELETE CASCADE`)
    }
  })

  it('uses the same primary key and index name and columns', () => {
    const pk = cfg.primaryKeys[0].columns.map((c) => c.name).join(', ')
    expect(s).toContain(`PRIMARY KEY (${pk})`)
    expect(cfg.indexes.length).toBe(1)
    const idx = cfg.indexes[0].config
    const cols = idx.columns.map((c) => (c as { name: string }).name).join(', ')
    expect(s).toContain(`INDEX IF NOT EXISTS ${idx.name} ON kb_article_usage (${cols})`)
  })
})

describe('hardPurgeOrg ordering', () => {
  const src = read('lib/db/queries/orgs.ts')
  const fn = src.slice(src.indexOf('export async function hardPurgeOrg'))

  it('clears usage rows inside the purge transaction, before the articles they reference', () => {
    const tx = fn.indexOf('.transaction(')
    const usage = fn.indexOf('tx.delete(kbArticleUsage)')
    const articles = fn.indexOf('tx.delete(kbArticles)')
    expect(tx).toBeGreaterThan(-1)
    expect(usage, 'usage delete must use the transaction handle').toBeGreaterThan(tx)
    expect(articles).toBeGreaterThan(usage)
  })

  it('scopes the usage delete to the purged workspace', () => {
    expect(fn).toContain('tx.delete(kbArticleUsage).where(eq(kbArticleUsage.orgId, orgId))')
  })
})
