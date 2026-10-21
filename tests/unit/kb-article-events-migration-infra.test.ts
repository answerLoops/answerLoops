import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { kbArticleEvents } from '@/lib/db/schema'

// Guards the deploy-time parts of the kb_article_events change: where the
// migration sorts, its re-run safety, the statements the runner executes, the
// CHECK lists agreeing with the TypeScript unions, the Drizzle table agreeing
// with the SQL, and org purge removing the rows before their review items.

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0060_kb_article_events.sql'
const BREAKPOINT = '--> statement-breakpoint'

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8')
}
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
}
/** The statements as lib/db/migrate.ts splits them: on the breakpoint marker, trimmed, empties dropped. */
function statements(): string[] {
  return read(`drizzle/${MIGRATION}`)
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter(Boolean)
}
/** One statement with comments removed and whitespace collapsed. */
function clean(stmt: string): string {
  return stripComments(stmt).replace(/\s+/g, ' ').trim()
}
function createTable(): string {
  const s = statements().map(clean).filter((x) => /^CREATE TABLE\b/i.test(x))
  expect(s).toHaveLength(1)
  return s[0]
}
function indexStatements(): string[] {
  return statements().map(clean).filter((x) => /^CREATE INDEX\b/i.test(x))
}
/** Splits the CREATE TABLE body on commas that sit outside any parentheses. */
function tableDefinitions(): string[] {
  const s = createTable()
  const inner = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'))
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of inner) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}
interface SqlColumn {
  name: string
  type: string
  notNull: boolean
  def: string
}
function sqlColumns(): SqlColumn[] {
  return tableDefinitions().map((d) => {
    const m = d.match(/^(\w+)\s+(\w+)/)!
    return {
      name: m[1],
      type: m[2].toUpperCase(),
      notNull: /\bNOT NULL\b/i.test(d) || /\bPRIMARY KEY\b/i.test(d),
      def: d,
    }
  })
}
function sqlColumn(name: string): SqlColumn {
  const c = sqlColumns().find((x) => x.name === name)
  expect(c, `no ${name} column in the SQL`).toBeDefined()
  return c!
}
/** Quoted members of the IN (...) list of the CHECK on a column. */
function checkValues(column: string): string[] {
  const d = sqlColumn(column).def
  const m = d.match(/CHECK\s*\(\s*\w+\s+IN\s*\(([^)]*)\)\s*\)/i)
  expect(m, `no CHECK ... IN (...) on ${column}`).not.toBeNull()
  return [...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1])
}
/** Members of an exported string-literal union type in types/index.ts. */
function unionMembers(name: string): string[] {
  const m = read('types/index.ts').match(new RegExp(`export type ${name} =([^\\n]*(?:\\n\\s*\\|[^\\n]*)*)`))
  expect(m, `type ${name} not found in types/index.ts`).not.toBeNull()
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe('0060 migration file ordering (lib/db/migrate.ts runs *.sql sorted by name)', () => {
  const files = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql')).sort()

  it('exists, is non-empty, and runs after the article created-by migration', () => {
    const p = path.join(DRIZZLE_DIR, MIGRATION)
    expect(fs.existsSync(p)).toBe(true)
    expect(fs.statSync(p).size).toBeGreaterThan(0)
    const prev = files.find((f) => f.startsWith('0059_'))
    expect(prev).toBeDefined()
    expect(files.indexOf(MIGRATION)).toBeGreaterThan(files.indexOf(prev!))
  })

  it('runs after the tables it references are created', () => {
    const creator = (table: string) =>
      files.findIndex((f) => new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?${table}"?[ (]`).test(read(`drizzle/${f}`)))
    for (const t of ['orgs', 'users', 'tickets', 'kb_articles', 'kb_review_items']) {
      const i = creator(t)
      expect(i, `no migration creates ${t}`).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(files.indexOf(MIGRATION))
    }
  })

  it('no two migrations share the 0060 numeric prefix', () => {
    const sharing = files.filter((f) => f.startsWith('0060_'))
    expect(sharing).toEqual([MIGRATION])
  })
})

describe('0060 migration is safe to re-run and never touches existing data', () => {
  it('creates the table and every index with IF NOT EXISTS', () => {
    expect(createTable()).toMatch(/^CREATE TABLE IF NOT EXISTS kb_article_events\s*\(/i)
    const idx = indexStatements()
    expect(idx).toHaveLength(3)
    for (const s of idx) expect(s).toMatch(/^CREATE INDEX IF NOT EXISTS\b/i)
  })

  it('contains only CREATE TABLE and CREATE INDEX statements', () => {
    const all = statements().map(clean)
    expect(all).toHaveLength(4)
    for (const s of all) expect(s).toMatch(/^CREATE (TABLE|INDEX) IF NOT EXISTS\b/i)
  })

  it('has no destructive or data-mutating statement', () => {
    const sql = stripComments(read(`drizzle/${MIGRATION}`))
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|UPDATE|INSERT|DELETE\s+FROM)\b/i)
    expect(sql).not.toMatch(/\bALTER\b[^;]*\bDROP\b/i)
  })
})

describe('migration runner compatibility (lib/db/migrate.ts)', () => {
  it('the runner splits on the same marker this file uses, and picks up .sql files', () => {
    const runner = read('lib/db/migrate.ts')
    expect(runner).toContain(`.split('${BREAKPOINT}')`)
    expect(runner).toContain(".filter((f) => f.endsWith('.sql'))")
    expect(MIGRATION.endsWith('.sql')).toBe(true)
  })

  it('splits into four chunks, each exactly one statement ending in a single semicolon', () => {
    const chunks = statements()
    expect(chunks).toHaveLength(4)
    for (const c of chunks) {
      const s = clean(c)
      expect(s.match(/;/g) ?? [], `chunk: ${s}`).toHaveLength(1)
      expect(s.endsWith(';')).toBe(true)
      expect(s).not.toContain(BREAKPOINT)
    }
  })

  it('the CREATE TABLE chunk has balanced parentheses and no quoted semicolons', () => {
    const s = createTable()
    expect(s.split('(').length).toBe(s.split(')').length)
    let depth = 0
    for (const ch of s) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
    expect(s).not.toMatch(/'[^']*;[^']*'/)
  })
})

describe('CHECK constraints agree with the TypeScript unions in types/index.ts', () => {
  it('type lists exactly the KBArticleEventType members', () => {
    const members = unionMembers('KBArticleEventType')
    expect(members.length).toBeGreaterThan(0)
    expect([...checkValues('type')].sort()).toEqual([...members].sort())
  })

  it('origin lists exactly the KBArticleEventOrigin members', () => {
    const members = unionMembers('KBArticleEventOrigin')
    expect(members.length).toBeGreaterThan(0)
    expect([...checkValues('origin')].sort()).toEqual([...members].sort())
  })
})

describe('Drizzle kbArticleEvents agrees with the SQL migration', () => {
  const cols = getTableColumns(kbArticleEvents)
  const family = (t: string) => (t.startsWith('serial') || t === 'integer' ? 'INTEGER' : t.toUpperCase())

  it('uses the same table name', () => {
    expect(getTableConfig(kbArticleEvents).name).toBe('kb_article_events')
    expect(createTable()).toContain('kb_article_events (')
  })

  it('has the same set of columns in both places', () => {
    const drizzleNames = Object.values(cols).map((c) => c.name).sort()
    const sqlNames = sqlColumns().map((c) => c.name).sort()
    expect(sqlNames).toEqual(drizzleNames)
  })

  it('every column has the same type family and nullability', () => {
    for (const col of Object.values(cols)) {
      const s = sqlColumn(col.name)
      const expectedType = family(col.getSQLType())
      // SERIAL is an INTEGER with a sequence in both places.
      expect(s.type === 'SERIAL' ? 'INTEGER' : s.type, `type of ${col.name}`).toBe(expectedType)
      expect(s.notNull, `nullability of ${col.name}`).toBe(col.notNull)
    }
  })

  it('created_at defaults to now() in both places', () => {
    expect(cols.createdAt.hasDefault).toBe(true)
    expect(sqlColumn('created_at').def).toMatch(/DEFAULT now\(\)/i)
  })

  it('foreign keys match the SQL REFERENCES target and ON DELETE action', () => {
    const expected: Record<string, [string, string, string]> = {
      org_id: ['orgs', 'id', 'cascade'],
      article_id: ['kb_articles', 'id', 'cascade'],
      actor_user_id: ['users', 'id', 'set null'],
      source_ticket_id: ['tickets', 'id', 'set null'],
      review_item_id: ['kb_review_items', 'id', 'set null'],
    }
    const fks = getTableConfig(kbArticleEvents).foreignKeys.map((fk) => ({ fk, ref: fk.reference() }))
    expect(fks).toHaveLength(Object.keys(expected).length)
    for (const [column, [table, target, action]] of Object.entries(expected)) {
      const hit = fks.filter(({ ref }) => ref.columns[0].name === column)
      expect(hit, `foreign key on ${column}`).toHaveLength(1)
      const { fk, ref } = hit[0]
      expect(getTableConfig(ref.foreignTable as never).name).toBe(table)
      expect(ref.foreignColumns[0].name).toBe(target)
      expect(fk.onDelete).toBe(action)
      expect(sqlColumn(column).def).toContain(`REFERENCES ${table}(${target}) ON DELETE ${action.toUpperCase()}`)
    }
  })

  it('the three indexes match the SQL index names and columns', () => {
    const fromSchema = getTableConfig(kbArticleEvents)
      .indexes.map((i) => ({
        name: i.config.name ?? '',
        cols: i.config.columns.map((c) => (c as { name: string }).name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const fromSql = indexStatements()
      .map((s) => {
        const m = s.match(/^CREATE INDEX IF NOT EXISTS (\w+) ON kb_article_events \(([^)]*)\);?$/i)
        expect(m, `unparseable index: ${s}`).not.toBeNull()
        return { name: m![1], cols: m![2].split(',').map((c) => c.trim()) }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    expect(fromSchema).toHaveLength(3)
    expect(fromSql).toEqual(fromSchema)
  })
})

describe('nullability that the history log depends on', () => {
  it('article_id is nullable, since rejections and reopenings happen before an article exists', () => {
    expect(sqlColumn('article_id').notNull).toBe(false)
    expect(sqlColumn('article_id').def).not.toMatch(/\bNOT NULL\b/i)
    expect(getTableColumns(kbArticleEvents).articleId.notNull).toBe(false)
  })

  it('content_hash is nullable, since review events with no article have nothing to hash', () => {
    expect(sqlColumn('content_hash').notNull).toBe(false)
    expect(getTableColumns(kbArticleEvents).contentHash.notNull).toBe(false)
  })

  it('org_id, type and origin stay required', () => {
    for (const c of ['org_id', 'type', 'origin']) expect(sqlColumn(c).notNull).toBe(true)
  })
})

describe('hardPurgeOrg removes the article events (lib/db/queries/orgs.ts)', () => {
  const src = read('lib/db/queries/orgs.ts')

  it('imports kbArticleEvents and deletes its rows for the org', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bkbArticleEvents\b[^}]*\}\s*from\s*'\.\.\/schema'/)
    expect(src).toMatch(/\.delete\(kbArticleEvents\)\.where\(eq\(kbArticleEvents\.orgId, orgId\)\)/)
  })

  it('deletes them before the review items they point at', () => {
    const events = src.indexOf('.delete(kbArticleEvents)')
    const items = src.indexOf('.delete(kbReviewItems)')
    expect(events).toBeGreaterThanOrEqual(0)
    expect(items).toBeGreaterThanOrEqual(0)
    expect(events).toBeLessThan(items)
  })
})
