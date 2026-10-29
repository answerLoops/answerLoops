import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import {
  kbSupportArticleFindings,
  kbSupportAssessments,
  kbSupportClaimFindings,
  kbSupportFlags,
  kbSupportSettings,
} from '@/lib/db/schema'
import { SUPPORT_LIMITS } from '@/lib/kb/support/limits'
import { FAIL_REASONS, SKIP_REASONS } from '@/lib/kb/support/state'
import { FLAG_NOTE_MAX, MAX_DAILY_LIMIT } from '@/lib/db/queries/kb-support'

// Guards the parts of the source-support storage change that only fail at
// deploy time: how the migration runner picks up the file, whether the SQL and
// the Drizzle tables agree, that the constraint lists match the TypeScript
// constants the code uses, and that nothing that could hold conversation text
// has a column. tests that run the SQL against a real database are in
// e2e/support-assessments.spec.ts.

const ROOT = process.cwd()
const MIGRATION = '0066_kb_support_assessments.sql'
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
const sqlText = read(`drizzle/${MIGRATION}`)
const sql = sqlText.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const TABLES = [
  ['kb_support_settings', kbSupportSettings],
  ['kb_support_assessments', kbSupportAssessments],
  ['kb_support_article_findings', kbSupportArticleFindings],
  ['kb_support_claim_findings', kbSupportClaimFindings],
  ['kb_support_flags', kbSupportFlags],
] as const

/** The comma-separated items of a parenthesized body, ignoring commas inside nested parentheses. */
function topLevelItems(body: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      items.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) items.push(current.trim())
  return items
}

function bodyOf(table: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
  expect(start, `no CREATE TABLE for ${table}`).toBeGreaterThanOrEqual(0)
  const open = sql.indexOf('(', start)
  let depth = 0
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++
    if (sql[i] === ')' && --depth === 0) return sql.slice(open + 1, i)
  }
  throw new Error(`unbalanced parentheses in ${table}`)
}

function columnsOf(table: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const item of topLevelItems(bodyOf(table))) {
    if (/^(CONSTRAINT|UNIQUE|PRIMARY KEY|CHECK)\b/i.test(item)) continue
    out.set(item.split(/\s+/)[0], item.replace(/\s+/g, ' '))
  }
  return out
}

/** The values of `CONSTRAINT <name> CHECK (... IN (...))` as a list. */
function checkList(constraint: string): string[] {
  const at = sql.indexOf(`CONSTRAINT ${constraint} CHECK`)
  expect(at, `no constraint ${constraint}`).toBeGreaterThanOrEqual(0)
  const m = /IN \(([^)]*)\)/.exec(sql.slice(at, at + 400))!
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
}

describe(MIGRATION, () => {
  const files = fs.readdirSync(path.join(ROOT, 'drizzle')).filter((f) => f.endsWith('.sql')).sort()

  it('is the only migration with its number and runs after the ones it references', () => {
    expect(files.filter((f) => f.startsWith('0066_'))).toEqual([MIGRATION])
    const creator = (table: string) => files.findIndex((f) => new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?${table}"?[ (]`).test(read(`drizzle/${f}`)))
    for (const t of ['orgs', 'users', 'kb_answers', 'kb_answer_references']) {
      const i = creator(t)
      expect(i, `no migration creates ${t}`).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(files.indexOf(MIGRATION))
    }
    expect(files[files.indexOf(MIGRATION) - 1]).toMatch(/^0065_/)
  })

  it('is safe to re-run: every CREATE is IF NOT EXISTS, and nothing else mutates schema or data', () => {
    const creates = sql.match(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\b[^;]*/gi) ?? []
    expect(creates).toHaveLength(12) // 5 tables, 7 indexes
    for (const c of creates) expect(c).toMatch(/\b(TABLE|INDEX)\s+IF NOT EXISTS\b/i)
    expect(sql.replace(/ON DELETE (CASCADE|SET NULL)/gi, '')).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
  })

  it('separates statements with the marker the runner splits on, one between each of the 12', () => {
    expect(sqlText.match(/--> statement-breakpoint/g)).toHaveLength(11)
  })

  it('leaves row-level security to the runner, which enables it on every public table', () => {
    const runner = read('lib/db/migrate.ts')
    expect(runner).toMatch(/schemaname = 'public' AND NOT rowsecurity/)
    expect(runner).toContain('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY')
  })
})

describe('what is stored', () => {
  it('has no column that could hold a question, an answer, a visitor or a ticket; text is only the bounded excerpts and the note', () => {
    const textColumns: Record<string, string[]> = {}
    for (const [name] of TABLES) {
      textColumns[name] = [...columnsOf(name)].filter(([, def]) => /\bTEXT\b/.test(def)).map(([col]) => col)
    }
    expect(textColumns).toEqual({
      kb_support_settings: [],
      kb_support_assessments: ['method', 'execution_state', 'skip_reason', 'fail_reason', 'answer_summary', 'judge_model'],
      kb_support_article_findings: ['article_content_hash', 'summary', 'reasons'],
      kb_support_claim_findings: ['label', 'claim_excerpt', 'passage_excerpt'],
      kb_support_flags: ['verdict', 'note'],
    })
  })

  it('bounds the evidence text to the quote limit, and a flag note to the note limit', () => {
    expect(sql).toContain(`char_length(claim_excerpt) <= ${SUPPORT_LIMITS.maxQuoteChars}`)
    expect(sql).toContain(`char_length(passage_excerpt) <= ${SUPPORT_LIMITS.maxQuoteChars}`)
    expect(sql).toContain(`char_length(note) <= ${FLAG_NOTE_MAX}`)
  })

  it('only allows evidence text alongside an expiry', () => {
    expect(sql).toMatch(/CHECK \(\(claim_excerpt IS NULL AND passage_excerpt IS NULL\) OR evidence_expires_at IS NOT NULL\)/)
  })

  it('every switch defaults to off and every limit to unset', () => {
    const settings = columnsOf('kb_support_settings')
    for (const col of ['widget_enabled', 'ticket_enabled', 'discord_enabled', 'agent_api_enabled', 'excerpt_storage_enabled']) {
      expect(settings.get(col), col).toMatch(/INTEGER NOT NULL DEFAULT 0\b/)
    }
    for (const col of ['sampling_rate', 'daily_limit']) expect(settings.get(col), col).not.toMatch(/NOT NULL|DEFAULT/)
    expect(sql).toMatch(/sampling_rate >= 0 AND sampling_rate <= 1/)
    expect(sql).toMatch(/daily_limit >= 0/)
    expect(MAX_DAILY_LIMIT).toBeGreaterThan(0)
  })
})

describe('the constraint lists are the TypeScript constants', () => {
  it('skip and fail reasons', () => {
    expect(checkList('kb_support_assessments_skip_reason_check')).toEqual([...SKIP_REASONS])
    expect(checkList('kb_support_assessments_fail_reason_check')).toEqual([...FAIL_REASONS])
  })

  it('stores only finished runs, and a conclusion only from a completed one', () => {
    expect(checkList('kb_support_assessments_state_check')).toEqual(['completed', 'failed', 'skipped'])
    expect(sql).toMatch(/CHECK \(execution_state = 'completed' OR answer_summary = 'not_assessed'\)/)
    expect(sql).toContain("execution_state = 'completed' AND skip_reason IS NULL AND fail_reason IS NULL")
    expect(sql).toContain("execution_state = 'skipped' AND skip_reason IS NOT NULL AND fail_reason IS NULL")
    expect(sql).toContain("execution_state = 'failed' AND fail_reason IS NOT NULL AND skip_reason IS NULL")
  })

  it('answer states, article states, labels and reasons', () => {
    expect(checkList('kb_support_assessments_summary_check')).toEqual(['supporting', 'no_support', 'inconclusive', 'not_assessed'])
    // A pair that was not assessed has no row, so the article summary has no not_assessed.
    expect(checkList('kb_support_article_findings_summary_check')).toEqual(['supporting', 'no_support', 'inconclusive'])
    // "none" is implicit; "inconclusive" is what a downgraded support is stored as.
    expect(checkList('kb_support_claim_findings_label_check')).toEqual(['supports', 'partial', 'contradicts', 'inconclusive'])
    expect(sql).toContain("reasons <@ ARRAY['off_topic', 'redundant']::text[]")
    expect(checkList('kb_support_flags_verdict_check')).toEqual(['agree', 'disagree'])
  })
})

describe('the idempotency key', () => {
  it('is the answer and the method version, never an article id, so deleting an article cannot break it', () => {
    expect(sql).toContain('CONSTRAINT uq_kb_support_assessments_answer_method UNIQUE (answer_id, method_version, rubric_version)')
    const unique = getTableConfig(kbSupportAssessments).uniqueConstraints.find((u) => u.name === 'uq_kb_support_assessments_answer_method')!
    expect(unique.columns.map((c) => c.name)).toEqual(['answer_id', 'method_version', 'rubric_version'])
  })

  it('keys a finding on the reference row, which survives its article, and has no article_id column at all', () => {
    expect(sql).toContain('CONSTRAINT uq_kb_support_article_findings_assessment_reference UNIQUE (assessment_id, reference_id)')
    expect([...columnsOf('kb_support_article_findings').keys()]).not.toContain('article_id')
  })

  it('allows one flag per person per target, with separate indexes for the article and the claim', () => {
    expect(sql).toMatch(/uq_kb_support_flags_article_user ON kb_support_flags \(article_finding_id, user_id\) WHERE claim_finding_id IS NULL AND user_id IS NOT NULL/)
    expect(sql).toMatch(/uq_kb_support_flags_claim_user ON kb_support_flags \(claim_finding_id, user_id\) WHERE claim_finding_id IS NOT NULL AND user_id IS NOT NULL/)
  })
})

describe('deletes cascade the way the single retention window needs', () => {
  const cascades = (table: PgTable) =>
    Object.fromEntries(
      getTableConfig(table).foreignKeys.map((fk) => {
        const ref = fk.reference()
        return [`${ref.columns[0].name}->${getTableConfig(ref.foreignTable).name}`, fk.onDelete]
      })
    )

  it('an assessment goes with its answer or workspace, and a finding with its assessment or reference row', () => {
    expect(cascades(kbSupportAssessments)).toEqual({ 'org_id->orgs': 'cascade', 'answer_id->kb_answers': 'cascade' })
    expect(cascades(kbSupportArticleFindings)).toEqual({
      'assessment_id->kb_support_assessments': 'cascade',
      'reference_id->kb_answer_references': 'cascade',
    })
    expect(cascades(kbSupportClaimFindings)).toEqual({ 'article_finding_id->kb_support_article_findings': 'cascade' })
  })

  it('settings go with the workspace, and flags with their finding, keeping the flag if the person is removed', () => {
    expect(cascades(kbSupportSettings)).toEqual({ 'org_id->orgs': 'cascade', 'updated_by->users': 'set null' })
    expect(cascades(kbSupportFlags)).toEqual({
      'org_id->orgs': 'cascade',
      'article_finding_id->kb_support_article_findings': 'cascade',
      'claim_finding_id->kb_support_claim_findings': 'cascade',
      'user_id->users': 'set null',
    })
  })

  it('the workspace purge names each source-support table, flags first, before the answers they hang from', () => {
    const orgs = read('lib/db/queries/orgs.ts')
    const at = (t: string) => orgs.indexOf(`tx.delete(${t})`)
    for (const t of ['kbSupportFlags', 'kbSupportAssessments', 'kbSupportSettings']) expect(at(t), t).toBeGreaterThan(-1)
    expect(at('kbSupportFlags')).toBeLessThan(at('kbSupportAssessments'))
    expect(at('kbSupportAssessments')).toBeLessThan(at('kbAnswers'))
    expect(at('kbSupportSettings')).toBeLessThan(at('kbAnswers'))
  })

  it('the workspace purge removes the answers (and so the assessments) before the articles, and the org last', () => {
    const orgs = read('lib/db/queries/orgs.ts')
    expect(orgs.indexOf('tx.delete(kbAnswers)')).toBeGreaterThan(-1)
    expect(orgs.indexOf('tx.delete(kbAnswers)')).toBeLessThan(orgs.indexOf('tx.delete(kbArticles)'))
    expect(orgs.indexOf('tx.delete(kbArticles)')).toBeLessThan(orgs.indexOf('tx.delete(orgs)'))
  })
})

describe('Drizzle tables agree with the SQL', () => {
  const family: Record<string, string> = {
    integer: 'INTEGER',
    serial: 'SERIAL',
    text: 'TEXT',
    uuid: 'UUID',
    'timestamp with time zone': 'TIMESTAMPTZ',
    'double precision': 'DOUBLE PRECISION',
    'integer[]': 'INTEGER[]',
    'text[]': 'TEXT[]',
  }

  for (const [name, table] of TABLES) {
    describe(name, () => {
      const cfg = getTableConfig(table)
      const sqlCols = columnsOf(name)

      it('declares the same columns', () => {
        expect(cfg.columns.map((c) => c.name).sort()).toEqual([...sqlCols.keys()].sort())
      })

      it('matches type and nullability per column', () => {
        for (const col of cfg.columns) {
          const def = sqlCols.get(col.name)!
          const type = family[col.getSQLType()] ?? col.getSQLType().toUpperCase()
          expect(def, `${col.name} type`).toContain(type)
          const nullable = !/\bNOT NULL\b/.test(def) && !/\bPRIMARY KEY\b/.test(def)
          expect(nullable, `${col.name} nullability`).toBe(!col.notNull && !col.primary)
        }
      })

      it('has the same foreign keys with the same delete behaviour', () => {
        for (const fk of cfg.foreignKeys) {
          const ref = fk.reference()
          const col = ref.columns[0].name
          const action = fk.onDelete === 'set null' ? 'ON DELETE SET NULL' : 'ON DELETE CASCADE'
          expect(sqlCols.get(col)!).toContain(`REFERENCES ${getTableConfig(ref.foreignTable).name}(${ref.foreignColumns[0].name}) ${action}`)
        }
      })

      it('declares each index and unique constraint under the name the SQL creates', () => {
        for (const idx of cfg.indexes) expect(sql, idx.config.name).toContain(idx.config.name)
        for (const u of cfg.uniqueConstraints) expect(sql, u.name).toContain(u.name!)
      })
    })
  }

  it('defaults agree: every switch 0, the arrays empty', () => {
    const cols = Object.fromEntries(getTableConfig(kbSupportSettings).columns.map((c) => [c.name, c.default]))
    for (const col of ['widget_enabled', 'ticket_enabled', 'discord_enabled', 'agent_api_enabled', 'excerpt_storage_enabled']) expect(cols[col]).toBe(0)
    expect(cols.sampling_rate).toBeUndefined()
    expect(cols.daily_limit).toBeUndefined()
    expect(columnsOf('kb_support_article_findings').get('reasons')).toContain("DEFAULT '{}'")
    expect(columnsOf('kb_support_article_findings').get('shared_with_reference_ids')).toContain("DEFAULT '{}'")
  })
})
