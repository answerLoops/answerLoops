import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pg-proxy'

// Regression coverage for a real production bug found while debugging why a
// connected Slack workspace's test message never became a ticket: the bot's
// Slack poller only ever polled DEFAULT_ORG_ID (org 1) — `loadSlackOrgIds()`
// called `listIntegrations(DEFAULT_ORG_ID)`, which is correctly scoped to
// exactly one org for its real callers, but was being misused here as if it
// scanned every org. Confirmed live: the actual connected integration was
// org_id 3, so the poller's active-org list was permanently empty for that
// org regardless of how many times the config_changed LISTEN/NOTIFY fired —
// the reload path was working correctly, it was just always re-asking about
// org 1.
//
// No DB connection: the query layer runs against drizzle's pg-proxy driver,
// which hands back the compiled SQL instead of opening a socket — same
// convention as tests/unit/api-generation-key-attribution.test.ts.

const ROOT = process.cwd()

function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const { calls } = vi.hoisted(() => ({ calls: [] as { sql: string; params: unknown[] }[] }))

const fakeDb = drizzle(async (sql: string, params: unknown[]) => {
  calls.push({ sql, params })
  return { rows: [] }
})

vi.mock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))

async function queries() {
  return import('@/lib/db/queries/integrations')
}

describe('migration + schema: org_feature_flags (generic per-org flag store)', () => {
  it('migration creates the table with a unique (org_id, key) index', () => {
    const src = read('drizzle/0025_org_feature_flags.sql')
    expect(src).toContain('CREATE TABLE IF NOT EXISTS org_feature_flags')
    expect(src).toContain('CREATE UNIQUE INDEX IF NOT EXISTS org_feature_flags_org_key ON org_feature_flags(org_id, key)')
  })

  it('schema declares the matching table with the same unique constraint', () => {
    const src = read('lib/db/schema.ts')
    const idx = src.indexOf("export const orgFeatureFlags = pgTable(\n  'org_feature_flags'")
    expect(idx).toBeGreaterThanOrEqual(0)
    const body = src.slice(idx, src.indexOf('\n)', idx))
    expect(body).toContain("uniqueIndex('org_feature_flags_org_key').on(t.orgId, t.key)")
  })
})

describe('lib/db/queries/integrations: listActiveSlackIntegrations is genuinely cross-org', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('compiled SQL filters on platform/enabled but carries no org_id predicate', async () => {
    const { listActiveSlackIntegrations } = await queries()
    await listActiveSlackIntegrations()

    expect(calls.length).toBeGreaterThan(0)
    const [{ sql }] = calls
    // org_id is a selected column (every row's own org needs to come back),
    // but the WHERE clause — the part that decides which rows match at
    // all — must not filter on it. The bug this test guards against is
    // exactly a stray `"org_id" = $n` predicate silently narrowing this
    // back down to one workspace.
    const whereClause = sql.slice(sql.indexOf(' where '))
    expect(whereClause).toContain('"platform"')
    expect(whereClause).toContain('"enabled"')
    expect(whereClause).not.toContain('"org_id"')
  })
})

describe('bot/index.ts: Slack polling — self-hosted always, cloud only via the slack_force_polling flag', () => {
  const src = read('bot/index.ts')

  function loadSlackOrgIdsBody(): string {
    const idx = src.indexOf('async function loadSlackOrgIds')
    expect(idx).toBeGreaterThanOrEqual(0)
    return src.slice(idx, src.indexOf('\n  }', idx))
  }

  it('loadSlackOrgIds uses the cross-org query, not a single-org lookup', () => {
    const body = loadSlackOrgIdsBody()
    expect(body).toContain('listActiveSlackIntegrations()')
    expect(body).not.toContain('DEFAULT_ORG_ID')
    expect(body).not.toContain('listIntegrations(')
  })

  it('self-hosted returns every connected org unconditionally, before any flag lookup', () => {
    const body = loadSlackOrgIdsBody()
    expect(body).toContain("if (getDeploymentMode() === 'self-hosted') return allOrgIds")
  })

  it('cloud filters down to orgs with the slack_force_polling flag set, not every connected org', () => {
    const body = loadSlackOrgIdsBody()
    expect(body).toContain("getOrgIdsWithFlag(allOrgIds, 'slack_force_polling')")
    expect(body).toContain('return allOrgIds.filter((id) => flagged.has(id))')
  })

  it('startup and config-reload call sites both just call loadSlackOrgIds unconditionally — the mode/flag branching lives in one place, not duplicated at each call site', () => {
    expect(src).toContain('const slackOrgIds = await loadSlackOrgIds()\n  startSlackPoller(slackOrgIds)')
    // Generalized from watchConfigChanges to watchNotifications when the KB
    // sync worker moved onto this same LISTEN connection.
    const idx = src.indexOf('const stopListening = watchNotifications')
    const body = src.slice(idx, src.indexOf('\n  })', idx))
    expect(body).toContain('const orgIds = await loadSlackOrgIds()')
    expect(body).toContain('reloadSlackPoller(orgIds)')
  })
})

describe('lib/db/queries/feature-flags.ts: getOrgIdsWithFlag', () => {
  it('short-circuits on an empty candidate list without querying the DB', async () => {
    const { getOrgIdsWithFlag } = await import('@/lib/db/queries/feature-flags')
    const result = await getOrgIdsWithFlag([], 'slack_force_polling')
    expect(result).toEqual(new Set())
  })

  it('filters on org_id IN (...), key, and value — and returns exactly the matching org ids', async () => {
    calls.length = 0
    const { getOrgIdsWithFlag } = await import('@/lib/db/queries/feature-flags')
    const result = await getOrgIdsWithFlag([3, 5, 9], 'slack_force_polling')
    expect(calls.length).toBeGreaterThan(0)
    const [{ sql, params }] = calls
    expect(sql).toContain('"org_id" in')
    expect(sql).toContain('"key"')
    expect(sql).toContain('"value"')
    expect(params).toContain('slack_force_polling')
    expect(params).toContain('1')
    expect(params).toEqual(expect.arrayContaining([3, 5, 9]))
    // The fakeDb driver above always returns empty rows, so the real
    // assertion here is on the compiled query shape, not the result set.
    expect(result).toEqual(new Set())
  })
})
