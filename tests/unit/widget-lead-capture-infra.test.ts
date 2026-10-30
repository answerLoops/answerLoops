import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pg-proxy'

// Infrastructure coverage for the widget lead-capture change (GitHub issue #11):
//   drizzle/0038_widget_lead_capture_mode.sql
//   lib/db/schema.ts            (orgs.widgetLeadCaptureMode)
//   lib/db/queries/widgets.ts   (getOrgByWidgetToken / getWidgetLeadCaptureMode /
//                                setWidgetLeadCaptureMode)
//   lib/widget/lead-capture.ts  (mode guard + human-request detector + header)
//
// app/api/widget/chat/route.ts's X-Widget-Lead-Signal header is covered in
// tests/unit/widget-lead-capture-chat-route.test.ts instead of here — that
// file mocks '@/lib/db/queries/widgets' wholesale (per
// tests/unit/widget-kb-only-context.test.ts), which would otherwise shadow
// the real module this file imports.
//
// No DB and no Docker: lib/db/queries/widgets.ts runs against drizzle's
// pg-proxy driver, which hands us the compiled SQL instead of opening a
// socket. app/actions/widget.ts is covered only at the source-text level (see
// the note at the bottom of this file) — there is no existing pattern in this
// repo for invoking a 'use server' action with a mocked session/auth layer,
// so deeper coverage of saveWidgetLeadCaptureModeAction is left to the
// component-test suite.

const ROOT = process.cwd()

function readFileAt(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

// ---------------------------------------------------------------------------
// Migration file
// ---------------------------------------------------------------------------

const MIGRATION = '0038_widget_lead_capture_mode.sql'
const migrationSql = () => readFileAt(path.join('drizzle', MIGRATION)).replace(/--[^\n]*/g, '')

describe(`drizzle/${MIGRATION}`, () => {
  it('exists and is non-empty', () => {
    expect(readFileAt(path.join('drizzle', MIGRATION)).trim().length).toBeGreaterThan(0)
    expect(migrationSql().trim().length).toBeGreaterThan(0)
  })

  it('adds the column with the hardcoded-gate default, matching DEFAULT_WIDGET_LEAD_CAPTURE_MODE', () => {
    expect(migrationSql()).toMatch(
      /ALTER TABLE\s+orgs\s+ADD COLUMN IF NOT EXISTS\s+widget_lead_capture_mode\s+TEXT\s+NOT NULL\s+DEFAULT\s+'on-failure'/i
    )
  })

  it('is idempotent, because the runner replays a whole file after a partial failure', () => {
    // lib/db/migrate.ts only records a file in __custom_migrations after all of
    // its statements succeed; a later statement failing mid-file means the
    // whole file re-runs from the top on the next deploy.
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
    const tables = [...migrationSql().matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_]+)/gi)].map(
      (m) => m[1]
    )
    expect(tables).toEqual(['orgs'])
    expect(migrationSql()).not.toMatch(/\b(DROP|CREATE TABLE|TRUNCATE|UPDATE|DELETE)\b/i)
  })
})

describe('lib/db/migrate.ts picks the migration up', () => {
  it('is discovered by the runner glob: a .sql file directly in drizzle/, sorted after earlier migrations', () => {
    const files = fs
      .readdirSync(path.join(ROOT, 'drizzle'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(files).toContain(MIGRATION)
    const idx = files.indexOf(MIGRATION)
    expect(files.slice(0, idx).every((f) => f < MIGRATION)).toBe(true)
  })

  it('has a unique numeric prefix, so ordering is deterministic', () => {
    const prefix = MIGRATION.slice(0, 4)
    const clashes = fs
      .readdirSync(path.join(ROOT, 'drizzle'))
      .filter((f) => f.endsWith('.sql') && f.startsWith(prefix))
    expect(clashes).toEqual([MIGRATION])
  })

  it('is hand-written, so it must not be registered in the drizzle journal', () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'drizzle/meta/_journal.json'), 'utf-8')
    ) as { entries: { tag: string }[] }
    expect(journal.entries.map((e) => e.tag)).not.toContain(MIGRATION.replace('.sql', ''))
  })
})

// ---------------------------------------------------------------------------
// lib/widget/lead-capture.ts — pure logic
// ---------------------------------------------------------------------------

import {
  isWidgetLeadCaptureMode,
  requestsHuman,
  WIDGET_LEAD_CAPTURE_MODES,
  WIDGET_LEAD_SIGNAL_HEADER,
  DEFAULT_WIDGET_LEAD_CAPTURE_MODE,
} from '@/lib/widget/lead-capture'

describe('isWidgetLeadCaptureMode', () => {
  it('accepts each of the three valid modes', () => {
    for (const mode of WIDGET_LEAD_CAPTURE_MODES) {
      expect(isWidgetLeadCaptureMode(mode)).toBe(true)
    }
  })

  it('rejects garbage strings, empty string, and non-string values', () => {
    expect(isWidgetLeadCaptureMode('always')).toBe(false)
    expect(isWidgetLeadCaptureMode('OFF')).toBe(false) // case-sensitive
    expect(isWidgetLeadCaptureMode('')).toBe(false)
    expect(isWidgetLeadCaptureMode(null)).toBe(false)
    expect(isWidgetLeadCaptureMode(undefined)).toBe(false)
    expect(isWidgetLeadCaptureMode(0)).toBe(false)
    expect(isWidgetLeadCaptureMode({})).toBe(false)
    expect(isWidgetLeadCaptureMode(['on-failure'])).toBe(false)
  })

  it('the default mode is itself one of the three valid modes', () => {
    expect(isWidgetLeadCaptureMode(DEFAULT_WIDGET_LEAD_CAPTURE_MODE)).toBe(true)
    expect(DEFAULT_WIDGET_LEAD_CAPTURE_MODE).toBe('on-failure')
  })
})

describe('requestsHuman', () => {
  it('matches realistic phrasings asking for a human', () => {
    expect(requestsHuman('can I talk to a human')).toBe(true)
    expect(requestsHuman('I want to speak with someone')).toBe(true)
    expect(requestsHuman('I want to chat with a rep')).toBe(true)
    expect(requestsHuman('Can you put me through to a real person?')).toBe(true)
    expect(requestsHuman('is there a live agent available')).toBe(true)
    expect(requestsHuman('I need human support please')).toBe(true)
    expect(requestsHuman('let me talk to a customer service rep')).toBe(true)
  })

  it('matches "connect"/"transfer" phrasings too', () => {
    // The first alternative's verb list originally only had talk/speak/chat —
    // "connect me with a representative" and "transfer me to a representative"
    // are at least as common a way to ask for a human and were a real gap
    // until connect/transfer were added alongside an optional "me".
    expect(requestsHuman('connect me with a representative')).toBe(true)
    expect(requestsHuman('connect me to a representative')).toBe(true)
    expect(requestsHuman('please transfer me to a representative')).toBe(true)
  })

  it('does not match "connect" used in an unrelated sense', () => {
    // The verb list is broad; confirm it still requires the to/with + human
    // noun right after rather than firing on "connect" alone.
    expect(requestsHuman('I cannot connect to the internet')).toBe(false)
    expect(requestsHuman('please connect this widget to my site')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(requestsHuman('CAN I TALK TO A HUMAN')).toBe(true)
  })

  it('does not match ordinary questions that merely contain the word "human" in an unrelated sense', () => {
    expect(requestsHuman('is this answer written by a human or an AI?')).toBe(false)
    expect(requestsHuman('what is human resources policy on vacation days')).toBe(false)
    expect(requestsHuman('how do humans perceive color')).toBe(false)
  })

  it('does not match an ordinary product question with no human-request language at all', () => {
    expect(requestsHuman('how do I reset my password')).toBe(false)
    expect(requestsHuman('')).toBe(false)
  })
})

describe('WIDGET_LEAD_SIGNAL_HEADER', () => {
  it('is the exact header name the route sets and the client is expected to read', () => {
    expect(WIDGET_LEAD_SIGNAL_HEADER).toBe('X-Widget-Lead-Signal')
  })
})

// ---------------------------------------------------------------------------
// lib/db/queries/widgets.ts — compiled SQL via pg-proxy, no connection
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

  it('rejects an invalid mode: throws and never reaches the database', async () => {
    const { setWidgetLeadCaptureMode } = await queries()
    await expect(setWidgetLeadCaptureMode(42, 'always-on')).rejects.toThrow(
      /Invalid widget lead capture mode/
    )
    expect(calls.length).toBe(0)
  })

  it('rejects an empty string', async () => {
    const { setWidgetLeadCaptureMode } = await queries()
    await expect(setWidgetLeadCaptureMode(42, '')).rejects.toThrow()
    expect(calls.length).toBe(0)
  })

  it.each(WIDGET_LEAD_CAPTURE_MODES)('accepts the valid mode %s and writes it scoped to one org', async (mode) => {
    const { setWidgetLeadCaptureMode } = await queries()
    await setWidgetLeadCaptureMode(42, mode)

    expect(calls.length).toBe(1)
    const [q] = calls
    expect(q.sql).toContain('update "orgs" set')
    expect(q.sql).toContain('"widget_lead_capture_mode" = $1')
    expect(q.sql).toMatch(/where "orgs"\."id" = \$2/)
    expect(q.params).toEqual([mode, 42])
  })

  it('touches no other column', async () => {
    const { setWidgetLeadCaptureMode } = await queries()
    await setWidgetLeadCaptureMode(42, 'off')

    const setClause = calls[0].sql.slice(calls[0].sql.indexOf('set '), calls[0].sql.indexOf('where '))
    expect(setClause).not.toContain('widget_token')
    expect(setClause).not.toContain('widget_allowed_origins')
    expect(setClause.match(/"[a-z_]+" = \$/g)).toEqual(['"widget_lead_capture_mode" = $'])
  })
})

describe('lib/db/queries/widgets: getWidgetLeadCaptureMode', () => {
  beforeEach(() => {
    calls.length = 0
    rowsFor.length = 0
  })

  it('returns the stored valid mode for the org', async () => {
    const { getWidgetLeadCaptureMode } = await queries()
    rowsFor.push({ match: 'select', rows: [['up-front']] })
    expect(await getWidgetLeadCaptureMode(42)).toBe('up-front')
  })

  it('falls back to the default when the stored value is not one of the three valid strings', async () => {
    const { getWidgetLeadCaptureMode } = await queries()
    rowsFor.push({ match: 'select', rows: [['garbage-legacy-value']] })
    expect(await getWidgetLeadCaptureMode(42)).toBe(DEFAULT_WIDGET_LEAD_CAPTURE_MODE)
  })

  it('falls back to the default when there is no row at all', async () => {
    const { getWidgetLeadCaptureMode } = await queries()
    expect(await getWidgetLeadCaptureMode(999)).toBe(DEFAULT_WIDGET_LEAD_CAPTURE_MODE)
  })
})

describe('lib/db/queries/widgets: getOrgByWidgetToken defensive read of widget_lead_capture_mode', () => {
  beforeEach(() => {
    calls.length = 0
    rowsFor.length = 0
  })

  it('selects the column', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, null, 'off', 'pro']],
    })
    await getOrgByWidgetToken('tok-abc')
    expect(calls[0].sql).toContain('"orgs"."widget_lead_capture_mode"')
  })

  it('passes through a valid stored mode unchanged', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, null, 'up-front', 'pro']],
    })
    const org = await getOrgByWidgetToken('tok-abc')
    expect(org!.widget_lead_capture_mode).toBe('up-front')
  })

  it('falls back to the default ("on-failure") when the stored column value is not one of the three valid strings', async () => {
    const { getOrgByWidgetToken } = await queries()
    // Simulates a row written before validation existed, or touched directly
    // outside setWidgetLeadCaptureMode.
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, null, 'legacy-garbage', 'pro']],
    })
    const org = await getOrgByWidgetToken('tok-abc')
    expect(org!.widget_lead_capture_mode).toBe('on-failure')
    expect(org!.widget_lead_capture_mode).toBe(DEFAULT_WIDGET_LEAD_CAPTURE_MODE)
  })

  it('falls back to the default when the stored column value is null', async () => {
    const { getOrgByWidgetToken } = await queries()
    rowsFor.push({
      match: 'select',
      rows: [[7, 'Acme', 'tok-abc', null, null, null, 'pro']],
    })
    const org = await getOrgByWidgetToken('tok-abc')
    expect(org!.widget_lead_capture_mode).toBe(DEFAULT_WIDGET_LEAD_CAPTURE_MODE)
  })
})

// ---------------------------------------------------------------------------
// app/actions/widget.ts — source-level only
// ---------------------------------------------------------------------------
//
// This repo has no existing pattern for invoking a 'use server' action with a
// mocked requireOrgAccess/session layer (the closest analogues in tests/unit/
// are *.test.tsx component tests that mock the action itself as a prop, not
// tests that exercise the action body). The existing coverage for this file's
// gating (tests/unit/widget-surface-hardening.test.ts, "gates destructive and
// configuration actions to owner/admin") already asserts, at the source level,
// that saveWidgetLeadCaptureModeAction is one of the three requireOrgAccess
// (WIDGET_ADMIN_ROLES) call sites — it was updated in this change to expect 3
// instead of 2. The checks below add the mode-validation half of that action
// that the existing describe block doesn't cover. Deeper (behavioral)
// coverage of the action is left to the component-test suite, per this task's
// instructions.
describe('app/actions/widget.ts: saveWidgetLeadCaptureModeAction (source-level)', () => {
  const src = () => readFileAt('app/actions/widget.ts')

  it('validates the submitted mode with the shared guard before writing it', () => {
    const s = src()
    expect(s).toContain('isWidgetLeadCaptureMode(mode)')
    expect(s).toMatch(/if \(!isWidgetLeadCaptureMode\(mode\)\) return \{ error:/)
  })

  it('is gated to owner/admin, the same class of decision as token rotation and the allowlist', () => {
    const s = src()
    const fn = s.slice(s.indexOf('export async function saveWidgetLeadCaptureModeAction'))
    expect(fn).toContain('requireOrgAccess(WIDGET_ADMIN_ROLES)')
  })

  it('getWidgetTokenAction also returns the current leadCaptureMode for the settings UI', () => {
    const s = src()
    const fn = s.slice(
      s.indexOf('export async function getWidgetTokenAction'),
      s.indexOf('export async function regenerateWidgetTokenAction')
    )
    expect(fn).toContain('getWidgetLeadCaptureMode(access.orgId)')
    expect(fn).toContain('leadCaptureMode,')
  })
})
