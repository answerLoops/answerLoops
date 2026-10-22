import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { kbArticles, users } from '@/lib/db/schema'

// Guards the deploy-time parts of the kb_articles.created_by change: where the
// migration sorts, its re-run safety and nullability, the Drizzle column
// agreeing with the SQL, and the shape the migration runner can execute.

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0059_kb_article_created_by.sql'

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8')
}
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
}
/** The executable SQL with comments removed and whitespace collapsed. */
function body(): string {
  return stripComments(read(`drizzle/${MIGRATION}`)).replace(/\s+/g, ' ').trim()
}

describe('0059 migration file ordering (lib/db/migrate.ts runs *.sql sorted by name)', () => {
  const files = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql')).sort()

  it('exists, is non-empty, and runs after the ticket draft skip reason migration', () => {
    const p = path.join(DRIZZLE_DIR, MIGRATION)
    expect(fs.existsSync(p)).toBe(true)
    expect(fs.statSync(p).size).toBeGreaterThan(0)
    const prev = files.find((f) => f.startsWith('0058_'))
    expect(prev).toBeDefined()
    expect(files.indexOf(MIGRATION)).toBeGreaterThan(files.indexOf(prev!))
  })

  it('runs after the tables it references are created', () => {
    const creator = (table: string) =>
      files.findIndex((f) => new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?${table}"?[ (]`).test(read(`drizzle/${f}`)))
    for (const t of ['kb_articles', 'users']) {
      const i = creator(t)
      expect(i, `no migration creates ${t}`).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(files.indexOf(MIGRATION))
    }
  })

  it('no two migrations share the 0059 numeric prefix', () => {
    const sharing = files.filter((f) => f.startsWith('0059_'))
    expect(sharing).toEqual([MIGRATION])
  })
})

describe('0059 migration statement', () => {
  it('adds created_by to kb_articles idempotently, as a single ALTER', () => {
    const s = body()
    expect(s).toMatch(/^ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS created_by INTEGER\b/i)
    expect(s.match(/\bALTER\s+TABLE\b/gi)).toHaveLength(1)
  })

  it('references users(id) with ON DELETE SET NULL', () => {
    expect(body()).toMatch(/\bREFERENCES users\(id\) ON DELETE SET NULL\s*;?$/i)
  })

  it('leaves the column nullable with no default, so null keeps meaning unknown', () => {
    const s = body()
    expect(s).not.toMatch(/\bNOT NULL\b/i)
    expect(s).not.toMatch(/\bDEFAULT\b/i)
  })

  it('does not backfill or otherwise mutate data', () => {
    expect(body()).not.toMatch(/\b(UPDATE|INSERT|DELETE\s+FROM|DROP|TRUNCATE)\b/i)
  })
})

describe('Drizzle column agrees with the SQL migration', () => {
  const col = getTableColumns(kbArticles).createdBy

  it('uses the same column name and integer type', () => {
    expect(col.name).toBe('created_by')
    expect(col.getSQLType()).toBe('integer')
    expect(body()).toContain(`ADD COLUMN IF NOT EXISTS ${col.name} INTEGER`)
  })

  it('is nullable with no default', () => {
    expect(col.notNull).toBe(false)
    expect(col.hasDefault).toBe(false)
  })

  it('has a foreign key to users.id that sets null on delete', () => {
    const fks = getTableConfig(kbArticles)
      .foreignKeys.map((fk) => ({ fk, ref: fk.reference() }))
      .filter(({ ref }) => ref.columns[0].name === 'created_by')
    expect(fks).toHaveLength(1)
    const { fk, ref } = fks[0]
    expect(ref.foreignTable).toBe(users)
    expect(ref.foreignColumns[0].name).toBe('id')
    expect(fk.onDelete).toBe('set null')
    expect(body()).toContain('REFERENCES users(id) ON DELETE SET NULL')
  })
})

describe('migration runner compatibility (lib/db/migrate.ts)', () => {
  const runner = read('lib/db/migrate.ts')

  it('the runner picks up .sql files and the file has that extension', () => {
    expect(runner).toContain(".filter((f) => f.endsWith('.sql'))")
    expect(MIGRATION.endsWith('.sql')).toBe(true)
  })

  it('has no quoted strings, so no semicolon can be mishandled, and ends with one terminator', () => {
    const s = body()
    expect(s).not.toMatch(/['"$]/)
    expect(s.match(/;/g) ?? []).toHaveLength(1)
    expect(s.endsWith(';')).toBe(true)
  })

  it('needs no statement-breakpoint marker because it is a single statement', () => {
    expect(read(`drizzle/${MIGRATION}`)).not.toContain('--> statement-breakpoint')
  })
})
