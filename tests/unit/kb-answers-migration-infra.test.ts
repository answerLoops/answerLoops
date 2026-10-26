import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { kbAnswerReferences, kbAnswers } from '@/lib/db/schema'

// Guards the parts of the answer-references change that only fail at deploy
// time: how the migration runner picks up the file, whether the SQL and the
// Drizzle table definitions agree, the nullable-article design, and the order
// of the workspace purge.

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0062_kb_answer_references.sql'

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
const sqlStatements = () =>
  read(`drizzle/${MIGRATION}`)
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')

/** The body of one CREATE TABLE, as `column name -> its definition line`. */
function tableLines(table: string): Map<string, string> {
  const s = sqlStatements()
  const start = s.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
  expect(start, `no CREATE TABLE for ${table}`).toBeGreaterThanOrEqual(0)
  const body = s.slice(s.indexOf('(', start) + 1, s.indexOf('\n);', start))
  const lines = body
    .split('\n')
    .map((l) => l.trim().replace(/,$/, ''))
    .filter((l) => l && !l.startsWith('CONSTRAINT') && !l.startsWith('PRIMARY KEY'))
  return new Map(lines.map((l) => [l.split(/\s+/)[0], l]))
}

describe('migration file ordering (lib/db/migrate.ts runs *.sql sorted by name)', () => {
  const files = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql')).sort()

  it('runs after the verification migration it follows', () => {
    const prev = files.find((f) => f.startsWith('0061_'))
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
    expect(creates.length).toBe(5)
    for (const c of creates) expect(c).toMatch(/\b(TABLE|INDEX)\s+IF NOT EXISTS\b/i)
    // The runner only skips "already exists" codes; anything else would abort a re-run.
    expect(s.replace(/ON DELETE (CASCADE|SET NULL)/gi, '')).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
  })

  it('separates statements with the breakpoint marker the runner splits on', () => {
    expect(read(`drizzle/${MIGRATION}`).match(/--> statement-breakpoint/g)).toHaveLength(4)
  })
})

describe('row-level security reaches the new tables without their own statement', () => {
  it('the runner enables RLS on every public table, and the migration does not need to', () => {
    const runner = read('lib/db/migrate.ts')
    expect(runner).toMatch(/schemaname = 'public' AND NOT rowsecurity/)
    expect(runner).toContain('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY')
  })
})

describe('what is stored', () => {
  it('has no column that could hold question text, answer text, a visitor or a ticket', () => {
    const columns = [...tableLines('kb_answers').keys(), ...tableLines('kb_answer_references').keys()]
    expect(columns.sort()).toEqual(
      ['answer_id', 'article_content_hash', 'article_id', 'created_at', 'id', 'id', 'org_id', 'outcome', 'rank', 'score', 'surface'].sort()
    )
  })

  it('limits the surface and the outcome to the values the code uses', () => {
    const s = sqlStatements()
    expect(s).toContain("CHECK (surface IN ('widget', 'ticket', 'discord', 'agent_api'))")
    expect(s).toContain("CHECK (outcome IN ('generated', 'failed'))")
  })
})

describe('Drizzle tables agree with the SQL migration', () => {
  const family: Record<string, string> = {
    uuid: 'UUID',
    integer: 'INTEGER',
    serial: 'SERIAL',
    text: 'TEXT',
    'timestamp with time zone': 'TIMESTAMPTZ',
    'double precision': 'DOUBLE PRECISION',
  }

  for (const [name, table] of [
    ['kb_answers', kbAnswers],
    ['kb_answer_references', kbAnswerReferences],
  ] as const) {
    describe(name, () => {
      const cfg = getTableConfig(table)
      const sqlCols = tableLines(name)

      it('declares the same columns', () => {
        expect([...sqlCols.keys()].sort()).toEqual(cfg.columns.map((c) => c.name).sort())
      })

      it('matches type and nullability per column', () => {
        for (const col of cfg.columns) {
          const line = sqlCols.get(col.name)!
          expect(line, `${col.name} type`).toContain(family[col.getSQLType()])
          const nullable = !/\bNOT NULL\b/.test(line) && !/\bPRIMARY KEY\b/.test(line)
          expect(nullable, `${col.name} nullability`).toBe(!col.notNull && !col.primary)
        }
      })

      it('has the same foreign keys with the same delete behaviour', () => {
        for (const fk of cfg.foreignKeys) {
          const ref = fk.reference()
          const col = ref.columns[0].name
          const action = fk.onDelete === 'set null' ? 'ON DELETE SET NULL' : 'ON DELETE CASCADE'
          expect(sqlCols.get(col)!).toContain(
            `REFERENCES ${getTableConfig(ref.foreignTable).name}(${ref.foreignColumns[0].name}) ${action}`
          )
        }
      })

      it('has the same indexes', () => {
        for (const idx of cfg.indexes) {
          const cols = idx.config.columns.map((c) => (c as { name: string }).name).join(', ')
          expect(sqlStatements()).toContain(`INDEX IF NOT EXISTS ${idx.config.name} ON ${name} (${cols})`)
        }
      })
    })
  }

  it('keeps the article reference nullable and deletes to null, so deleting an article keeps the trace', () => {
    const cfg = getTableConfig(kbAnswerReferences)
    const articleId = cfg.columns.find((c) => c.name === 'article_id')!
    expect(articleId.notNull).toBe(false)
    expect(cfg.foreignKeys.find((fk) => fk.reference().columns[0].name === 'article_id')!.onDelete).toBe('set null')
    expect(cfg.columns.find((c) => c.name === 'article_content_hash')!.notNull).toBe(true)
  })

  it('makes one row per article per answer a unique constraint, not a primary key on a nullable column', () => {
    const cfg = getTableConfig(kbAnswerReferences)
    expect(cfg.primaryKeys).toHaveLength(0)
    expect(cfg.uniqueConstraints).toHaveLength(1)
    expect(cfg.uniqueConstraints[0].columns.map((c) => c.name)).toEqual(['answer_id', 'article_id'])
    expect(sqlStatements()).toContain('CONSTRAINT uq_kb_answer_references_answer_article UNIQUE (answer_id, article_id)')
    expect(sqlStatements()).not.toMatch(/PRIMARY KEY \(answer_id/)
  })

  it('cascades from the workspace and from the answer', () => {
    const answers = getTableConfig(kbAnswers).foreignKeys[0]
    expect(answers.onDelete).toBe('cascade')
    const refs = getTableConfig(kbAnswerReferences).foreignKeys.find((fk) => fk.reference().columns[0].name === 'answer_id')!
    expect(refs.onDelete).toBe('cascade')
  })
})

describe('hardPurgeOrg ordering', () => {
  const src = read('lib/db/queries/orgs.ts')
  const fn = src.slice(src.indexOf('export async function hardPurgeOrg'))

  it('clears answers inside the purge transaction, before the articles they reference', () => {
    const tx = fn.indexOf('.transaction(')
    const answers = fn.indexOf('tx.delete(kbAnswers)')
    const articles = fn.indexOf('tx.delete(kbArticles)')
    expect(tx).toBeGreaterThan(-1)
    expect(answers, 'answers delete must use the transaction handle').toBeGreaterThan(tx)
    expect(articles).toBeGreaterThan(answers)
  })

  it('scopes the answers delete to the purged workspace', () => {
    expect(fn).toContain('tx.delete(kbAnswers).where(eq(kbAnswers.orgId, orgId))')
  })
})
