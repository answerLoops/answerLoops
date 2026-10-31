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

  it('adds the column to orgs as NOT NULL text, defaulted to up-front', () => {
    expect(migrationSql()).toMatch(
      new RegExp(`ALTER TABLE\\s+orgs\\s+ADD COLUMN IF NOT EXISTS\\s+${COLUMN}\\s+TEXT\\s+NOT\\s+NULL`, 'i')
    )
    // 'up-front' — the old hardcoded gate — not 'on-failure': this column's
    // own default backfills every workspace that existed before it shipped,
    // so it must match what they already had rather than silently switching
    // their widget's behavior. A new workspace gets 'on-failure' explicitly
    // at creation instead — see auth.ts and the "new org" describe block below.
    expect(migrationSql()).toMatch(/DEFAULT\s+'up-front'/i)
    expect(migrationSql()).not.toMatch(/DEFAULT\s+'on-failure'/i)
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
  it('declares a NOT NULL text column defaulted to up-front, matching the migration', async () => {
    const { orgs } = await import('@/lib/db/schema')
    const col = getTableConfig(orgs).columns.find((c) => c.name === COLUMN)
    expect(col, `${COLUMN} missing from the Drizzle orgs table`).toBeDefined()
    expect(col!.getSQLType()).toBe('text')
    expect(col!.notNull).toBe(true)
    expect(col!.hasDefault).toBe(true)
    expect(col!.default).toBe('up-front')
  })
})

describe('auth.ts: a brand-new org gets the product default, not the column default', () => {
  it('sets widgetLeadCaptureMode explicitly on the new-org insert', () => {
    // No existing harness in this repo mocks the DB-backed OAuth sign-in flow
    // auth.ts's new-org path runs inside, so this is a source-level check —
    // same convention as the other source-shape assertions in this file.
    const src = fs.readFileSync(path.join(ROOT, 'auth.ts'), 'utf-8')
    const insertIdx = src.indexOf('.insert(orgs)')
    expect(insertIdx, 'auth.ts no longer inserts into orgs the way this test expects').toBeGreaterThan(-1)
    const valuesBlock = src.slice(insertIdx, insertIdx + 400)
    expect(valuesBlock).toContain('widgetLeadCaptureMode: DEFAULT_WIDGET_LEAD_CAPTURE_MODE')
    expect(src).toMatch(/import \{ DEFAULT_WIDGET_LEAD_CAPTURE_MODE \} from '@\/lib\/widget\/lead-capture'/)
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
  FALLBACK_WIDGET_LEAD_CAPTURE_MODE,
  isWidgetLeadCaptureMode,
  isWidgetLeadSignal,
  requestsHuman,
  isGreetingOrAck,
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
    // The read-time fallback must match the column's own default, not the
    // new-workspace default, so an unrecognised value never silently drops
    // an existing workspace's up-front gate.
    expect(FALLBACK_WIDGET_LEAD_CAPTURE_MODE).toBe('up-front')
    expect(migrationSql()).toMatch(/DEFAULT\s+'up-front'/i)
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

describe('lib/widget/lead-capture: isGreetingOrAck', () => {
  it('matches bare greetings and acknowledgements, with or without punctuation', () => {
    const positives = ['hi', 'Hello!', 'hey', 'thanks', 'thank you', 'thx', 'ty', 'ok', 'okay', 'k', 'cool', 'great', 'nice', 'good', 'got it', 'sounds good', 'perfect', 'awesome', 'bye', 'cheers', '  hi  ', 'Thanks!!']
    for (const q of positives) {
      expect(isGreetingOrAck(q), q).toBe(true)
    }
  })

  it('does not match a real question, even a short one', () => {
    const negatives = ['pricing?', 'how do I reset my password', 'hi, how do I reset my password', 'thanks for the help, but I still have an issue', '']
    for (const q of negatives) {
      expect(isGreetingOrAck(q), q).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// lib/widget/lead-signal-stash.ts — process-local Map, no mocking needed
// ---------------------------------------------------------------------------

describe('lib/widget/lead-signal-stash', () => {
  const TOKEN_A = 'a'.repeat(48)
  const TOKEN_B = 'b'.repeat(48)

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('round-trips a signal for a given (widgetToken, visitorId, sessionId) key', async () => {
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'tab-1', 'no-kb-match')
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'tab-1')).toBe('no-kb-match')
  })

  it('a different visitorId under the same widget does not see another visitor\'s signal', async () => {
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'tab-1', 'human-requested')
    expect(getLeadSignal(TOKEN_A, 'visitor-b', 'tab-1')).toBe('none')
  })

  it('the same visitorId under a different widget does not see another widget\'s signal', async () => {
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'tab-1', 'human-requested')
    expect(getLeadSignal(TOKEN_B, 'visitor-a', 'tab-1')).toBe('none')
  })

  it('two tabs open as the same visitor keep separate signals', async () => {
    const { setLeadSignal, getLeadSignal, clearLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'tab-1', 'no-kb-match')
    // Tab 2 starting a run clears *its own* entry only; tab 1's result stays.
    clearLeadSignal(TOKEN_A, 'visitor-a', 'tab-2')
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'tab-2')).toBe('none')
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'tab-1')).toBe('no-kb-match')
  })

  it('returns "none" for a key that was never set', async () => {
    const { getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    expect(getLeadSignal(TOKEN_A, 'never-seen', 'tab-1')).toBe('none')
  })

  it('an expired entry reads back as "none"', async () => {
    // Fake timers so Date.now() can be advanced past the module's 30s TTL
    // without a real wait. Only one get() call here, deliberately:
    // getLeadSignal deletes what it reads (see the next test), so a read
    // before expiry would make the later "none" come from that deletion, not
    // from the TTL check this test is about.
    vi.useFakeTimers()
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'tab-1', 'human-requested')
    vi.advanceTimersByTime(31_000) // TTL is 30_000ms
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'tab-1')).toBe('none')
  })

  it('getLeadSignal deletes the entry it reads, so a second poll does not see the same result twice', async () => {
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'tab-1', 'no-kb-match')
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'tab-1')).toBe('no-kb-match')
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'tab-1')).toBe('none')
  })

  it('getLeadSignal also sweeps other expired entries, so a quiet widget does not hold them forever', async () => {
    vi.useFakeTimers()
    const { setLeadSignal, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-old', 'tab-1', 'no-kb-match')
    vi.advanceTimersByTime(61_000) // past both the 30s TTL and the 60s sweep interval
    // A read for an unrelated key is what triggers the sweep here; no
    // setLeadSignal call follows it.
    expect(getLeadSignal(TOKEN_B, 'visitor-x', 'tab-1')).toBe('none')
    expect(getLeadSignal(TOKEN_A, 'visitor-old', 'tab-1')).toBe('none')
  })

  it('clearLeadSignal removes a pending entry outright', async () => {
    const { setLeadSignal, getLeadSignal, clearLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'tab-1', 'no-kb-match')
    clearLeadSignal(TOKEN_A, 'visitor-a', 'tab-1')
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'tab-1')).toBe('none')
  })

  it('clearLeadSignal is a no-op for a key with nothing stored', async () => {
    const { getLeadSignal, clearLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    expect(() => clearLeadSignal(TOKEN_A, 'visitor-never-set', 'tab-1')).not.toThrow()
    expect(getLeadSignal(TOKEN_A, 'visitor-never-set', 'tab-1')).toBe('none')
  })

  it('models the failure-after-success scenario: a cleared signal from a prior turn never leaks into a later, failed one', async () => {
    // app/api/widget/chat/route.ts calls clearLeadSignal as soon as the
    // request's token, visitor and session are validated, before any check
    // that can reject the run. This proves the stash-level half of that
    // guarantee: once cleared, nothing is left for the next poll to find.
    const { setLeadSignal, getLeadSignal, clearLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'tab-1', 'no-kb-match') // turn 1: a real miss
    clearLeadSignal(TOKEN_A, 'visitor-a', 'tab-1') // turn 2 accepted, clears turn 1's result
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'tab-1')).toBe('none')
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

  it('falls back to the column default (up-front) when the stored value is not a valid mode', async () => {
    const { getWidgetLeadCaptureMode } = await queries()
    rowsFor.push({ match: 'select', rows: [['something-bogus']] })
    expect(await getWidgetLeadCaptureMode(42)).toBe(FALLBACK_WIDGET_LEAD_CAPTURE_MODE)
  })

  it('falls back to the column default (up-front) when the org has no row', async () => {
    const { getWidgetLeadCaptureMode } = await queries()
    expect(await getWidgetLeadCaptureMode(999)).toBe(FALLBACK_WIDGET_LEAD_CAPTURE_MODE)
  })
})

describe('lib/db/queries/widgets: getOrgByWidgetToken defensive fallback', () => {
  beforeEach(() => {
    calls.length = 0
    rowsFor.length = 0
  })

  it('falls back to up-front when the stored column value is not one of the three valid strings', async () => {
    const { getOrgByWidgetToken } = await queries()
    // Positional row, in select order: id, name, widget_token,
    // widget_token_expires_at, widget_allowed_origins, widget_lead_capture_mode, plan_id.
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, null, 'legacy-garbage-value', 'pro']],
    })
    const org = await getOrgByWidgetToken('tok-abc')
    expect(org!.widget_lead_capture_mode).toBe(FALLBACK_WIDGET_LEAD_CAPTURE_MODE)
  })

  it('falls back to up-front when the stored column value is NULL (a row written before the column existed, backfilled without a default)', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, null, null, 'pro']],
    })
    const org = await getOrgByWidgetToken('tok-abc')
    expect(org!.widget_lead_capture_mode).toBe('up-front')
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

describe('app/widget/[widgetToken]/page.tsx: passes the org\'s mode through to WidgetChat', () => {
  it('threads org.widget_lead_capture_mode into the leadCaptureMode prop', () => {
    // No existing test in this repo live-invokes this async server component
    // (mocking next/headers, next/navigation's notFound, etc. for it) —
    // widget-surface-hardening.test.ts's own coverage of this file is
    // source-level too. Matching that convention rather than inventing a new
    // harness for one prop.
    const src = fs.readFileSync(path.join(ROOT, 'app/widget/[widgetToken]/page.tsx'), 'utf-8')
    expect(src).toMatch(/leadCaptureMode=\{org\.widget_lead_capture_mode\}/)
  })
})
