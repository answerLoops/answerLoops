import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableConfig } from 'drizzle-orm/pg-core'

/**
 * Infrastructure coverage for the per-org widget lead-capture mode:
 *   drizzle/0070_widget_lead_capture_mode.sql
 *   lib/db/schema.ts            (orgs.widgetLeadCaptureMode)
 *   lib/db/queries/widgets.ts   (getOrgByWidgetToken's fallback,
 *                                getWidgetLeadCaptureMode / setWidgetLeadCaptureMode)
 *   lib/widget/lead-capture.ts  (mode/signal guards, requestsHuman)
 *   lib/widget/lead-signal-stash.ts (process-local signal store)
 *
 * No DB, no Docker: the query functions run against drizzle's pg-proxy driver
 * (compiled SQL handed to a callback instead of a socket), same as
 * tests/unit/widget-allowed-origins-infra.test.ts. The product behaviour of
 * *when* the widget shows the lead prompt is covered by the route-level
 * suites (widget-lead-capture-chat-route.test.ts, widget-lead-signal-route.test.ts);
 * this file is the plumbing underneath it.
 */

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0070_widget_lead_capture_mode.sql'
const COLUMN = 'widget_lead_capture_mode'

function readFileAt(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const readMigration = () => readFileAt(path.join('drizzle', MIGRATION))

/** Migration text with `-- ...` comments stripped, so prose can't accidentally satisfy a SQL assertion. */
const migrationSql = () => readMigration().replace(/--[^\n]*/g, '')

// ---------------------------------------------------------------------------
// Migration file
// ---------------------------------------------------------------------------

describe(`drizzle/${MIGRATION}`, () => {
  it('exists and is non-empty', () => {
    expect(readMigration().trim().length).toBeGreaterThan(0)
    expect(migrationSql().trim().length).toBeGreaterThan(0)
  })

  it('adds the column to orgs as NOT NULL text, defaulted to on-failure', () => {
    expect(migrationSql()).toMatch(
      new RegExp(`ALTER TABLE\\s+orgs\\s+ADD COLUMN IF NOT EXISTS\\s+${COLUMN}\\s+TEXT\\s+NOT\\s+NULL`, 'i')
    )
    expect(migrationSql()).toMatch(/DEFAULT\s+'on-failure'/i)
  })

  it('is idempotent via IF NOT EXISTS, since the runner replays a whole file after a partial failure', () => {
    const statements = migrationSql()
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(statements.length).toBe(1)
    for (const stmt of statements) {
      expect(stmt, stmt).toMatch(/IF NOT EXISTS/i)
    }
  })

  it('touches only the orgs table', () => {
    const tables = [...migrationSql().matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_]+)/gi)].map((m) => m[1])
    expect(tables).toEqual(['orgs'])
    expect(migrationSql()).not.toMatch(/\b(DROP|CREATE TABLE|TRUNCATE|UPDATE|DELETE)\b/i)
  })

  it('has a unique numeric prefix among drizzle/*.sql, so ordering is deterministic', () => {
    const prefix = MIGRATION.slice(0, 4)
    const clashes = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql') && f.startsWith(prefix))
    expect(clashes).toEqual([MIGRATION])
  })

  it('is discovered by the migration runner glob and sorts after every earlier migration', () => {
    const files = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(files).toContain(MIGRATION)
    const idx = files.indexOf(MIGRATION)
    expect(files.slice(0, idx).every((f) => f < MIGRATION)).toBe(true)

    const orgsMigration = files.find((f) =>
      fs.readFileSync(path.join(DRIZZLE_DIR, f), 'utf-8').match(/CREATE TABLE (IF NOT EXISTS )?"?orgs"?/i)
    )
    expect(orgsMigration, 'no migration creates the orgs table').toBeDefined()
    expect(orgsMigration! < MIGRATION).toBe(true)
  })

  it('is hand-written, so it must not be registered in the drizzle journal', () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf-8')
    ) as { entries: { tag: string }[] }
    expect(journal.entries.map((e) => e.tag)).not.toContain(MIGRATION.replace('.sql', ''))
  })
})

// ---------------------------------------------------------------------------
// Schema <-> migration agreement, from real Drizzle metadata
// ---------------------------------------------------------------------------

describe('lib/db/schema: orgs.widgetLeadCaptureMode matches the migration', () => {
  it('declares a NOT NULL text column defaulted to on-failure', async () => {
    const { orgs } = await import('@/lib/db/schema')
    const col = getTableConfig(orgs).columns.find((c) => c.name === COLUMN)
    expect(col, `${COLUMN} missing from the Drizzle orgs table`).toBeDefined()
    expect(col!.getSQLType()).toBe('text')
    expect(col!.notNull).toBe(true)
    expect(col!.hasDefault).toBe(true)
    expect(col!.default).toBe('on-failure')
  })

  it('is reachable under the camelCase name the query layer uses', async () => {
    const { orgs } = await import('@/lib/db/schema')
    expect(orgs.widgetLeadCaptureMode).toBeDefined()
    expect(orgs.widgetLeadCaptureMode.name).toBe(COLUMN)
  })

  it('adds no index or constraint the migration does not create', async () => {
    const { orgs } = await import('@/lib/db/schema')
    const cfg = getTableConfig(orgs)
    const touching = [
      ...cfg.indexes.filter((i) => i.config.columns.some((c) => (c as { name?: string }).name === COLUMN)),
      ...cfg.uniqueConstraints.filter((u) => u.columns.some((c) => c.name === COLUMN)),
    ]
    expect(touching).toEqual([])
    expect(migrationSql()).not.toMatch(/CREATE (UNIQUE )?INDEX/i)
  })
})

// ---------------------------------------------------------------------------
// lib/widget/lead-capture.ts — pure guards and regex, no mocking needed
// ---------------------------------------------------------------------------

import {
  WIDGET_LEAD_CAPTURE_MODES,
  WIDGET_LEAD_SIGNALS,
  DEFAULT_WIDGET_LEAD_CAPTURE_MODE,
  isWidgetLeadCaptureMode,
  isWidgetLeadSignal,
  requestsHuman,
} from '@/lib/widget/lead-capture'

describe('lib/widget/lead-capture: isWidgetLeadCaptureMode', () => {
  it('accepts every valid mode', () => {
    for (const mode of WIDGET_LEAD_CAPTURE_MODES) {
      expect(isWidgetLeadCaptureMode(mode)).toBe(true)
    }
  })

  it('rejects garbage, empty, and non-string values', () => {
    for (const bad of ['', 'On-Failure', 'always', 'OFF', 0, null, undefined, {}, [], true]) {
      expect(isWidgetLeadCaptureMode(bad)).toBe(false)
    }
  })

  it('the default mode is itself a valid mode', () => {
    expect(isWidgetLeadCaptureMode(DEFAULT_WIDGET_LEAD_CAPTURE_MODE)).toBe(true)
    expect(DEFAULT_WIDGET_LEAD_CAPTURE_MODE).toBe('on-failure')
  })
})

describe('lib/widget/lead-capture: isWidgetLeadSignal', () => {
  it('accepts every valid signal', () => {
    for (const signal of WIDGET_LEAD_SIGNALS) {
      expect(isWidgetLeadSignal(signal)).toBe(true)
    }
  })

  it('rejects garbage, empty, and non-string values', () => {
    for (const bad of ['', 'None', 'no-match', 'human_requested', 0, null, undefined, {}, [], false]) {
      expect(isWidgetLeadSignal(bad)).toBe(false)
    }
  })
})

describe('lib/widget/lead-capture: requestsHuman', () => {
  it('matches realistic explicit requests for a human', () => {
    const positives = [
      'can you connect me with a representative',
      'please transfer me to a representative',
      'I want to talk to a human',
      'can I speak with an agent',
      'connect me to a person please',
      'let me chat with someone',
      'is there a real human I can talk to',
      'I need a live agent',
      'is there human support available',
      'can I speak to a customer service rep',
      'get me a customer service representative',
    ]
    for (const q of positives) {
      expect(requestsHuman(q), q).toBe(true)
    }
  })

  it('is case-insensitive', () => {
    expect(requestsHuman('CONNECT ME WITH A REPRESENTATIVE')).toBe(true)
  })

  it('does not match ordinary sentences that merely contain "human" or "connect" unrelated to a request', () => {
    const negatives = [
      'I cannot connect to the internet',
      'the human eye is amazing',
      'humans have been using tools for ages',
      'please connect the cable to the router',
      'how do I connect my account to Slack',
      'thanks, that answers my question',
      'this article was written for humans, not bots',
      'I need human intervention', // close, but "human" alone is not "human support"
    ]
    for (const q of negatives) {
      expect(requestsHuman(q), q).toBe(false)
    }
  })

  it('does not match an empty string', () => {
    expect(requestsHuman('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// lib/widget/lead-signal-stash.ts — process-local Map, no mocking needed
// ---------------------------------------------------------------------------

describe('lib/widget/lead-signal-stash', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('round-trips a signal for a given (orgId, visitorId) key', async () => {
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(1, 'visitor-a', 'no-kb-match')
    expect(getLeadSignal(1, 'visitor-a')).toBe('no-kb-match')
  })

  it('a different visitorId under the same org does not see another visitor\'s signal', async () => {
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(1, 'visitor-a', 'human-requested')
    expect(getLeadSignal(1, 'visitor-b')).toBe('none')
  })

  it('the same visitorId under a different org does not see another org\'s signal', async () => {
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(1, 'visitor-a', 'human-requested')
    expect(getLeadSignal(2, 'visitor-a')).toBe('none')
  })

  it('returns "none" for a key that was never set', async () => {
    const { getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    expect(getLeadSignal(999, 'never-seen')).toBe('none')
  })

  it('an expired entry reads back as "none"', async () => {
    // Fake timers so Date.now() can be advanced past the module's 30s TTL
    // without a real wait. The module's own sweep runs on a 60s interval
    // gated by its own Date.now() check (not setInterval), so advancing
    // Date.now() alone — without also running any queued timers — cannot
    // trigger an unrelated background sweep mid-test; getLeadSignal's own
    // expiry check (`entry.expiresAt < Date.now()`) is what this test
    // exercises, independent of the sweep.
    vi.useFakeTimers()
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(1, 'visitor-a', 'human-requested')
    expect(getLeadSignal(1, 'visitor-a')).toBe('human-requested')
    vi.advanceTimersByTime(31_000) // TTL is 30_000ms
    expect(getLeadSignal(1, 'visitor-a')).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Query layer — compiled SQL, no connection (drizzle pg-proxy)
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

describe('lib/db/queries/widgets: setWidgetLeadCaptureMode', () => {
  beforeEach(() => {
    calls.length = 0
    rowsFor.length = 0
  })

  it('accepts each of the three valid modes and writes them scoped to one org', async () => {
    const { setWidgetLeadCaptureMode } = await queries()
    for (const mode of ['off', 'on-failure', 'up-front'] as const) {
      calls.length = 0
      await setWidgetLeadCaptureMode(42, mode)
      expect(calls.length).toBe(1)
      const [q] = calls
      expect(q.sql).toContain('update "orgs" set')
      expect(q.sql).toContain(`"${COLUMN}" = $1`)
      expect(q.sql).toMatch(/where "orgs"\."id" = \$2/)
      expect(q.params).toEqual([mode, 42])
    }
  })

  it('rejects an invalid mode and never calls update', async () => {
    const { setWidgetLeadCaptureMode } = await queries()
    await expect(setWidgetLeadCaptureMode(42, 'always')).rejects.toThrow(/Invalid widget lead capture mode/)
    expect(calls.length).toBe(0)
  })

  it('rejects empty string and garbage casing, never calling update', async () => {
    const { setWidgetLeadCaptureMode } = await queries()
    for (const bad of ['', 'On-Failure', 'OFF', 'none']) {
      await expect(setWidgetLeadCaptureMode(42, bad)).rejects.toThrow()
    }
    expect(calls.length).toBe(0)
  })
})

describe('lib/db/queries/widgets: getWidgetLeadCaptureMode', () => {
  beforeEach(() => {
    calls.length = 0
    rowsFor.length = 0
  })

  it('returns the stored valid mode', async () => {
    const { getWidgetLeadCaptureMode } = await queries()
    rowsFor.push({ match: 'select', rows: [['up-front']] })
    expect(await getWidgetLeadCaptureMode(42)).toBe('up-front')
  })

  it('falls back to the default when the stored value is not a valid mode', async () => {
    const { getWidgetLeadCaptureMode } = await queries()
    rowsFor.push({ match: 'select', rows: [['something-bogus']] })
    expect(await getWidgetLeadCaptureMode(42)).toBe(DEFAULT_WIDGET_LEAD_CAPTURE_MODE)
  })

  it('falls back to the default when the org has no row', async () => {
    const { getWidgetLeadCaptureMode } = await queries()
    expect(await getWidgetLeadCaptureMode(999)).toBe(DEFAULT_WIDGET_LEAD_CAPTURE_MODE)
  })
})

describe('lib/db/queries/widgets: getOrgByWidgetToken defensive fallback', () => {
  beforeEach(() => {
    calls.length = 0
    rowsFor.length = 0
  })

  it('falls back to on-failure when the stored column value is not one of the three valid strings', async () => {
    const { getOrgByWidgetToken } = await queries()
    // Positional row, in select order: id, name, widget_token,
    // widget_token_expires_at, widget_allowed_origins, widget_lead_capture_mode, plan_id.
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, null, 'legacy-garbage-value', 'pro']],
    })
    const org = await getOrgByWidgetToken('tok-abc')
    expect(org!.widget_lead_capture_mode).toBe(DEFAULT_WIDGET_LEAD_CAPTURE_MODE)
  })

  it('falls back to on-failure when the stored column value is NULL (a row written before the column existed, backfilled without a default)', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, null, null, 'pro']],
    })
    const org = await getOrgByWidgetToken('tok-abc')
    expect(org!.widget_lead_capture_mode).toBe('on-failure')
  })

  it('passes a valid stored mode straight through, unchanged', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, null, 'up-front', 'pro']],
    })
    const org = await getOrgByWidgetToken('tok-abc')
    expect(org!.widget_lead_capture_mode).toBe('up-front')
  })
})
