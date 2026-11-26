import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableConfig } from 'drizzle-orm/pg-core'

// The owner's daily limit on widget answers:
//   drizzle/0090_widget_daily_answer_limit.sql
//   lib/db/schema.ts           (orgs.widgetDailyAnswerLimit)
//   lib/db/queries/widgets.ts  (getWidgetDailyAnswerLimit, setWidgetDailyAnswerLimit,
//                               and the widget_daily_answer_limit / widget_slug
//                               fields on the org the widget routes load)
//
// No database: the query functions run against drizzle's pg-proxy driver, which
// hands over the compiled SQL and parameters instead of opening a connection.

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0090_widget_daily_answer_limit.sql'
const COLUMN = 'widget_daily_answer_limit'

const readMigration = () => fs.readFileSync(path.join(DRIZZLE_DIR, MIGRATION), 'utf-8')
/** The SQL with `--` comments removed, so the explanatory prose cannot satisfy an assertion. */
const migrationSql = () => readMigration().replace(/--[^\n]*/g, '')

describe(`drizzle/${MIGRATION}`, () => {
  it('adds a nullable integer column to orgs, safe to apply twice', () => {
    expect(migrationSql()).toMatch(
      new RegExp(`ALTER TABLE\\s+orgs\\s+ADD COLUMN IF NOT EXISTS\\s+${COLUMN}\\s+INTEGER\\s*;`, 'i')
    )
  })

  it('has no NOT NULL or DEFAULT, so every existing workspace keeps the instance ceiling', () => {
    // NULL is "no limit of the owner's own". A default would quietly give
    // every workspace a limit it never chose.
    expect(migrationSql()).not.toMatch(/NOT\s+NULL/i)
    expect(migrationSql()).not.toMatch(/\bDEFAULT\b/i)
  })

  it('is a single replay-safe statement touching only orgs', () => {
    const statements = migrationSql()
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(statements).toHaveLength(1)
    expect(statements[0]).toMatch(/IF NOT EXISTS/i)
    expect(migrationSql()).not.toMatch(/\b(DROP|CREATE TABLE|TRUNCATE|UPDATE|DELETE|CREATE (UNIQUE )?INDEX)\b/i)
  })

  it('is picked up by the runner, after the migration before it and with a unique number', () => {
    const files = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(files).toContain(MIGRATION)
    expect(files.indexOf(MIGRATION)).toBeGreaterThan(files.indexOf('0089_circle_replies.sql'))
    expect(files.filter((f) => f.startsWith('0090_'))).toEqual([MIGRATION])
  })
})

describe('lib/db/schema.ts: orgs.widgetDailyAnswerLimit', () => {
  it('matches the migration: a nullable integer with no default', async () => {
    const { orgs } = await import('@/lib/db/schema')
    expect(orgs.widgetDailyAnswerLimit.name).toBe(COLUMN)
    const col = getTableConfig(orgs).columns.find((c) => c.name === COLUMN)
    expect(col).toBeDefined()
    expect(col!.getSQLType()).toBe('integer')
    expect(col!.notNull).toBe(false)
    expect(col!.hasDefault).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Query layer
// ---------------------------------------------------------------------------

const { calls, rowsFor } = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  rowsFor: [] as { match: string; rows: unknown[][] }[],
}))

const fakeDb = drizzle(async (sql: string, params: unknown[]) => {
  calls.push({ sql, params })
  const hit = rowsFor.find((r) => sql.includes(r.match))
  return { rows: hit ? hit.rows : [] }
})

vi.mock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))

const queries = () => import('@/lib/db/queries/widgets')
const TOKEN = 'c3'.repeat(24)

/**
 * A positional row in findWidgetOrg's select order: id, name, widget_token,
 * widget_token_expires_at, widget_slug, widget_allowed_origins,
 * widget_lead_capture_mode, widget_answer_scope, widget_guidance,
 * widget_daily_answer_limit, widget_title, widget_welcome, widget_brand_color,
 * widget_starter_questions, widget_starter_enabled, widget_follow_ups_enabled,
 * plan_id.
 */
function orgRow(slug: string | null, dailyLimit: unknown): unknown[] {
  return [7, 'Acme', TOKEN, null, slug, 'acme.test', 'on-failure', 'general', null, dailyLimit, null, null, null, null, null, null, 'pro']
}

beforeEach(() => {
  calls.length = 0
  rowsFor.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getOrgByWidgetToken: the limit and the slug', () => {
  it('selects both columns and returns them', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({ match: 'select', rows: [orgRow('acme-help', 250)] })
    const org = await getOrgByWidgetToken(TOKEN)
    expect(calls[0].sql).toContain(`"${COLUMN}"`)
    expect(calls[0].sql).toContain('"widget_slug"')
    expect(org).toMatchObject({ widget_slug: 'acme-help', widget_daily_answer_limit: 250 })
  })

  it('returns null for both when unset', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({ match: 'select', rows: [orgRow(null, null)] })
    expect(await getOrgByWidgetToken(TOKEN)).toMatchObject({ widget_slug: null, widget_daily_answer_limit: null })
  })

  it.each([0, -5])('reads a stored limit of %s as no limit of the owner\'s own', async (stored) => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({ match: 'select', rows: [orgRow(null, stored)] })
    expect((await getOrgByWidgetToken(TOKEN))!.widget_daily_answer_limit).toBeNull()
  })
})

describe('getWidgetDailyAnswerLimit', () => {
  it("reads one org's limit", async () => {
    const { getWidgetDailyAnswerLimit } = await queries()
    rowsFor.push({ match: 'select', rows: [[400]] })
    expect(await getWidgetDailyAnswerLimit(42)).toBe(400)
    expect(calls[0].sql).toContain(`"${COLUMN}"`)
    expect(calls[0].sql).toMatch(/where "orgs"\."id" = \$1/)
    expect(calls[0].params).toEqual([42, 1])
  })

  it('returns null for no value, an unusable value, or a missing org', async () => {
    const { getWidgetDailyAnswerLimit } = await queries()
    rowsFor.push({ match: 'select', rows: [[null]] })
    expect(await getWidgetDailyAnswerLimit(42)).toBeNull()
    rowsFor.length = 0
    rowsFor.push({ match: 'select', rows: [[0]] })
    expect(await getWidgetDailyAnswerLimit(42)).toBeNull()
    rowsFor.length = 0
    expect(await getWidgetDailyAnswerLimit(999)).toBeNull()
  })
})

describe('setWidgetDailyAnswerLimit', () => {
  it('writes the limit to one org and no other column', async () => {
    const { setWidgetDailyAnswerLimit } = await queries()
    await setWidgetDailyAnswerLimit(42, 1_500)
    expect(calls).toHaveLength(1)
    const [q] = calls
    expect(q.sql).toContain('update "orgs" set')
    expect(q.sql).toMatch(/where "orgs"\."id" = \$2/)
    const setClause = q.sql.slice(q.sql.indexOf('set '), q.sql.indexOf('where '))
    expect(setClause.match(/"[a-z_]+" = \$/g)).toEqual([`"${COLUMN}" = $`])
    expect(q.params).toEqual([1_500, 42])
  })

  it('clears the limit with NULL', async () => {
    const { setWidgetDailyAnswerLimit } = await queries()
    await setWidgetDailyAnswerLimit(42, null)
    expect(calls[0].params).toEqual([null, 42])
  })

  it('throws and writes nothing for a value above the instance ceiling', async () => {
    vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_DAY', '1000')
    const { setWidgetDailyAnswerLimit } = await queries()
    await expect(setWidgetDailyAnswerLimit(42, 1_001)).rejects.toThrow(/at most 1,000 answers/)
    expect(calls).toHaveLength(0)
    await setWidgetDailyAnswerLimit(42, 1_000)
    expect(calls[0].params).toEqual([1_000, 42])
  })

  it('throws and writes nothing for zero or a negative number', async () => {
    const { setWidgetDailyAnswerLimit } = await queries()
    await expect(setWidgetDailyAnswerLimit(42, 0)).rejects.toThrow()
    await expect(setWidgetDailyAnswerLimit(42, -1)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})
