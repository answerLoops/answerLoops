import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { REVIEW_STATES } from '@/lib/kb/review-state'

/**
 * drizzle/0091_kb_article_review_state.sql against lib/db/schema.ts and
 * types/index.ts. The migration is hand-written, so nothing at compile time
 * stops it drifting from the drizzle declaration, from the review states the
 * code writes, or from the event types the code records. A drift here shows up
 * in production as a failed insert (check constraint) or a query against a
 * column that does not exist.
 */

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

const MIGRATION = 'drizzle/0091_kb_article_review_state.sql'
const sql = read(MIGRATION)
const schema = read('lib/db/schema.ts')
const types = read('types/index.ts')

/** The source of one pgTable(...) declaration, so a field on another table cannot satisfy a check. */
function tableBlock(exportName: string): string {
  const start = schema.indexOf(`export const ${exportName} = pgTable(`)
  expect(start, `${exportName} declared in schema.ts`).toBeGreaterThan(-1)
  const end = schema.indexOf('\n)', start)
  return schema.slice(start, end)
}

/** Column fields of a table block keyed by SQL column name, each with its full (possibly multi-line) source. */
function schemaColumns(block: string): Map<string, { field: string; src: string; kind: string }> {
  const indexesAt = block.indexOf('(t) =>')
  // Drop comment lines so words in a comment cannot satisfy or break a check.
  const columnsPart = block
    .slice(0, indexesAt === -1 ? undefined : indexesAt)
    .replace(/^\s*\/\/.*$/gm, '')
  const starts = [...columnsPart.matchAll(/^\s{4}(\w+):\s*(\w+)\('([a-z0-9_]+)'/gm)]
  const out = new Map<string, { field: string; src: string; kind: string }>()
  starts.forEach((m, i) => {
    const from = m.index!
    const to = i + 1 < starts.length ? starts[i + 1].index! : columnsPart.length
    out.set(m[3], { field: m[1], kind: m[2], src: columnsPart.slice(from, to) })
  })
  return out
}

/** SQL table name -> exported schema constant, read from `export const x = pgTable('name'`. */
function tableExports(): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of schema.matchAll(/export const (\w+) = pgTable\(\s*'([a-z0-9_]+)'/g)) map.set(m[2], m[1])
  return map
}

/** The `IN (...)` list of a named CHECK constraint's last ADD in a SQL file. */
function checkList(src: string, constraint: string): string[] {
  const re = new RegExp(`ADD CONSTRAINT ${constraint} CHECK \\(\\s*\\w+ IN \\(([^)]*)\\)`, 'g')
  const matches = [...src.matchAll(re)]
  expect(matches.length, `${constraint} added`).toBeGreaterThan(0)
  return [...matches.at(-1)![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** The members of a string-literal union type in types/index.ts. */
function unionMembers(name: string): string[] {
  const m = types.match(new RegExp(`export type ${name} =([\\s\\S]*?)\\n\\n`))
  expect(m, `${name} declared`).not.toBeNull()
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

const sorted = (xs: readonly string[]) => [...xs].sort()

interface AddedColumn {
  name: string
  type: string
  notNull: boolean
  default: string | null
  references: { table: string; column: string; onDelete: string | null } | null
}

const addedColumns: AddedColumn[] = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS (\w+) ([^,;]+)/g)].map((m) => {
  const rest = m[2]
  const ref = rest.match(/REFERENCES (\w+)\((\w+)\)(?: ON DELETE (SET NULL|CASCADE|RESTRICT|NO ACTION))?/i)
  const def = rest.match(/DEFAULT ('[^']*'|\S+)/i)
  return {
    name: m[1],
    type: rest.trim().split(/\s+/)[0].toUpperCase(),
    notNull: /NOT NULL/i.test(rest),
    default: def ? def[1] : null,
    references: ref ? { table: ref[1], column: ref[2], onDelete: ref[3]?.toUpperCase() ?? null } : null,
  }
})

describe('migration 0091 columns match kbArticles in schema.ts', () => {
  const cols = schemaColumns(tableBlock('kbArticles'))
  const exportsByTable = tableExports()

  it('adds exactly the six review-state columns to kb_articles, idempotently', () => {
    expect(sql).toMatch(/ALTER TABLE kb_articles\s+ADD COLUMN IF NOT EXISTS review_state/)
    expect(addedColumns.map((c) => c.name)).toEqual([
      'review_state',
      'review_state_at',
      'review_state_by',
      'review_note',
      'superseded_by_article_id',
      'superseded_by_url',
    ])
    expect(sql).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/)
  })

  it('declares every added column in schema.ts with the same type', () => {
    for (const c of addedColumns) {
      const decl = cols.get(c.name)
      expect(decl, `${c.name} declared on kbArticles`).toBeDefined()
      expect({ col: c.name, kind: decl!.kind }).toEqual({ col: c.name, kind: c.type.toLowerCase() })
    }
  })

  it('matches nullability: only review_state is NOT NULL, on both sides', () => {
    for (const c of addedColumns) {
      const schemaNotNull = /\.notNull\(\)/.test(cols.get(c.name)!.src)
      expect({ col: c.name, notNull: schemaNotNull }).toEqual({ col: c.name, notNull: c.notNull })
    }
    expect(addedColumns.filter((c) => c.notNull).map((c) => c.name)).toEqual(['review_state'])
  })

  it("defaults review_state to 'current' on both sides, so existing articles keep answering", () => {
    expect(addedColumns.find((c) => c.name === 'review_state')!.default).toBe("'current'")
    expect(cols.get('review_state')!.src).toMatch(/\.default\('current'\)/)
    expect(REVIEW_STATES).toContain('current')
    for (const c of addedColumns.filter((x) => x.name !== 'review_state')) {
      expect({ col: c.name, default: c.default }).toEqual({ col: c.name, default: null })
      expect(cols.get(c.name)!.src).not.toMatch(/\.default\(/)
    }
  })

  it('points both foreign keys at the same targets with ON DELETE SET NULL on both sides', () => {
    const fks = addedColumns.filter((c) => c.references)
    expect(fks.map((c) => [c.name, c.references])).toEqual([
      ['review_state_by', { table: 'users', column: 'id', onDelete: 'SET NULL' }],
      ['superseded_by_article_id', { table: 'kb_articles', column: 'id', onDelete: 'SET NULL' }],
    ])
    for (const c of fks) {
      const src = cols.get(c.name)!.src
      const target = exportsByTable.get(c.references!.table)
      expect(target, `schema export for ${c.references!.table}`).toBeDefined()
      expect(src).toMatch(new RegExp(`\\.references\\([^]*?=>\\s*${target}\\.${c.references!.column}\\b`))
      expect(src).toMatch(/onDelete:\s*'set null'/)
    }
    // The other columns carry no reference in either place.
    for (const c of addedColumns.filter((x) => !x.references)) {
      expect(cols.get(c.name)!.src).not.toMatch(/\.references\(/)
    }
  })

  it('declares the (org_id, review_state) index in both the SQL and schema.ts', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_kb_articles_org_review_state ON kb_articles \(org_id, review_state\)/)
    expect(tableBlock('kbArticles')).toMatch(/index\('idx_kb_articles_org_review_state'\)\.on\(t\.orgId, t\.reviewState\)/)
  })
})

describe('migration 0091 check constraints', () => {
  it('allows exactly the review states the code writes', () => {
    expect(sorted(checkList(sql, 'kb_articles_review_state_check'))).toEqual(sorted(REVIEW_STATES))
    // And the type agrees too.
    expect(sorted(unionMembers('ArticleReviewState'))).toEqual(sorted(REVIEW_STATES))
  })

  /**
   * Evaluates the replacement CHECK as written, for every combination, so a
   * rewrite that keeps the shape but changes the logic still fails here.
   */
  describe('replacement check', () => {
    const m = sql.match(/ADD CONSTRAINT kb_articles_replacement_check CHECK \(([\s\S]*?)\);/)
    const body = m?.[1] ?? ''
    const toJs = (expr: string) =>
      expr
        .replace(/(\w+) IS NOT NULL/g, '($1 !== null)')
        .replace(/(\w+) IS NULL/g, '($1 === null)')
        .replace(/\bAND\b/g, '&&')
        .replace(/\bOR\b/g, '||')
        .replace(/(\w+) = ('[^']*')/g, '($1 === $2)')
    type Check = (s: string, a: number | null, u: string | null) => boolean
    let compiled: Check | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      compiled = new Function('review_state', 'superseded_by_article_id', 'superseded_by_url', `return (${toJs(body)})`) as Check
    } catch {
      compiled = null
    }
    const check: Check = (s, a, u) => {
      expect(compiled, 'replacement check uses only IS NULL / IS NOT NULL / = / AND / OR').not.toBeNull()
      return compiled!(s, a, u)
    }

    it('is present', () => {
      expect(m).not.toBeNull()
      expect(compiled).not.toBeNull()
      // Only the pieces the evaluator understands, so a new operator is not silently ignored.
      expect(body.replace(/'[^']*'/g, '').replace(/\b(IS|NOT|NULL|AND|OR|review_state|superseded_by_article_id|superseded_by_url)\b|[()=\s]/g, '')).toBe('')
    })

    const cases: [string, number | null, string | null, boolean][] = []
    for (const state of REVIEW_STATES)
      for (const a of [null, 5])
        for (const u of [null, 'https://docs.example.com/x'])
          cases.push([state, a, u, state === 'superseded' ? !(a !== null && u !== null) : a === null && u === null])

    it.each(cases)('state %s, article %s, url %s -> allowed %s', (state, a, u, allowed) => {
      expect(check(state, a, u)).toBe(allowed)
    })
  })

  it('widens the kb_article_events type check to exactly the KBArticleEventType union', () => {
    expect(sorted(checkList(sql, 'kb_article_events_type_check'))).toEqual(sorted(unionMembers('KBArticleEventType')))
  })

  it('keeps every event type migration 0061 allowed', () => {
    const before = checkList(read('drizzle/0061_kb_article_verification.sql'), 'kb_article_events_type_check')
    expect(before.length).toBeGreaterThan(0)
    const after = checkList(sql, 'kb_article_events_type_check')
    for (const t of before) expect(after).toContain(t)
  })

  it.each(['kb_articles_review_state_check', 'kb_articles_replacement_check', 'kb_article_events_type_check'])(
    'drops %s if it exists before adding it, so re-running is safe',
    (name) => {
      const drop = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${name};`)
      const add = sql.indexOf(`ADD CONSTRAINT ${name} `)
      expect(drop).toBeGreaterThan(-1)
      expect(add).toBeGreaterThan(drop)
      // Only one add, so the drop guards it.
      expect(sql.split(`ADD CONSTRAINT ${name} `)).toHaveLength(2)
    }
  )

  it('separates every statement with a statement-breakpoint', () => {
    const statements = sql
      .replace(/^--(?!>).*$/gm, '')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const s of statements) expect(s.match(/;\s*$/g) ?? []).toHaveLength(1)
    expect(statements.length).toBe(sql.match(/;\s*$/gm)!.length)
  })
})

describe('migration ordering', () => {
  const files = fs.readdirSync(path.join(ROOT, 'drizzle')).filter((f) => f.endsWith('.sql'))

  // Later migrations come after this one, so only its own place is pinned:
  // straight after every migration numbered below it, with its number unused
  // by any other file.
  it('runs right after the 0090 migrations and its number is not reused', () => {
    const sorted = [...files].sort()
    const index = sorted.indexOf(path.basename(MIGRATION))
    expect(index).toBeGreaterThan(-1)
    expect(sorted.slice(0, index).every((f) => f < '0091_')).toBe(true)
    expect(sorted[index - 1].startsWith('0090_')).toBe(true)
    expect(files.filter((f) => f.startsWith('0091_'))).toEqual([path.basename(MIGRATION)])
  })

  it('is the last migration to redefine the kb_article_events type check', () => {
    const redefining = [...files].sort().filter((f) => read(`drizzle/${f}`).includes('ADD CONSTRAINT kb_article_events_type_check'))
    expect(redefining.at(-1)).toBe(path.basename(MIGRATION))
  })
})
