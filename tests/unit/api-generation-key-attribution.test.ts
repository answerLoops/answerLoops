import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableConfig } from 'drizzle-orm/pg-core'

// Infrastructure coverage for the per-key usage attribution change:
//   drizzle/0019_api_generation_key_attribution.sql
//   lib/db/schema.ts            (api_generations.key_id + idx_api_generations_key)
//   lib/db/queries/api-generations.ts
//   lib/http/client-ip.ts       (TRUST_PROXY_HOPS documentation only)
//
// Behaviour of the MCP/agent surfaces themselves is covered by
// tests/unit/mcp-audit-hardening.test.ts — this file deliberately does not
// repeat it. No DB or Docker daemon: the query functions run against
// drizzle's pg-proxy driver, which hands us the compiled SQL instead of a
// socket, and everything else is file-system or table-metadata assertions.

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0019_api_generation_key_attribution.sql'

function readFileAt(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const readMigration = () => readFileAt(path.join('drizzle', MIGRATION))

// ---------------------------------------------------------------------------
// Query layer — compiled SQL, no connection
// ---------------------------------------------------------------------------

const { calls, rowsFor } = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  // Per-test canned result rows, keyed by a substring of the compiled SQL.
  // pg-proxy expects positional rows (arrays), matching the select order.
  rowsFor: [] as { match: string; rows: unknown[][] }[],
}))

// pg-proxy hands the compiled SQL and bound params to a callback instead of a
// socket, so the real query builders run with no database anywhere.
const fakeDb = drizzle(async (sql: string, params: unknown[]) => {
  calls.push({ sql, params })
  const hit = rowsFor.find((r) => sql.includes(r.match))
  return { rows: hit ? hit.rows : [] }
})

vi.mock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))

async function queries() {
  return import('@/lib/db/queries/api-generations')
}

describe('lib/db/queries/api-generations: compiled SQL', () => {
  beforeEach(() => {
    calls.length = 0
    rowsFor.length = 0
  })

  // The insert uses RETURNING, so the proxy has to hand back a row id.
  const reservedRow = () => rowsFor.push({ match: 'insert into "api_generations"', rows: [[123]] })

  it('reserveApiGeneration writes the key id into the insert', async () => {
    reservedRow()
    const { reserveApiGeneration } = await queries()
    await reserveApiGeneration(42, 7)

    const [insert] = calls
    expect(insert.sql).toContain('insert into "api_generations"')
    expect(insert.sql).toContain('"key_id"')
    // org_id, key_id, high_confidence — key_id must be a real bound value, not
    // dropped on the floor, or a leaked credential can't be traced to its calls.
    expect(insert.params).toEqual([42, 7, 0])
  })

  it('reserveApiGeneration still writes a row when no key drove the call', async () => {
    reservedRow()
    const { reserveApiGeneration } = await queries()
    await reserveApiGeneration(42)

    const [insert] = calls
    expect(insert.sql).toContain('"key_id"')
    expect(insert.params).toEqual([42, null, 0])
  })

  it('reserveApiGeneration reserves unbilled and returns the row id', async () => {
    reservedRow()
    const { reserveApiGeneration } = await queries()
    const id = await reserveApiGeneration(42, 7)
    expect(id).toBe(123)

    const [insert] = calls
    // high_confidence must be 0 on insert. Reserving as already-billed would
    // charge for answers the model never got confident about, and a crash
    // before promotion would leave the org billed for nothing.
    expect(insert.params[2]).toBe(0)
    expect(insert.sql).toContain('returning')
  })

  it('markApiGenerationBilled promotes exactly one row by id', async () => {
    const { markApiGenerationBilled } = await queries()
    await markApiGenerationBilled(31)

    const [update] = calls
    expect(update.sql).toContain('update "api_generations"')
    expect(update.sql).toContain('"high_confidence"')
    expect(update.sql).toContain('where')
    // Scoped by row id, not by org — promoting by org would bill every
    // in-flight reservation the moment any one of them succeeded.
    expect(update.params).toEqual([1, 31])
  })

  it('getMonthlyApiGenerationAttempts counts every call, not just billable ones', async () => {
    rowsFor.push({ match: 'count(*)', rows: [[9]] })
    const { getMonthlyApiGenerationAttempts } = await queries()
    const n = await getMonthlyApiGenerationAttempts(42, new Date('2026-07-01T00:00:00.000Z'))

    expect(n).toBe(9)
    const [q] = calls
    // The attempt ceiling exists because every call costs an embedding plus two
    // LLM round trips. Filtering on high_confidence here would let a caller burn
    // unlimited compute by asking questions the KB can't answer.
    expect(q.sql).not.toContain('high_confidence')
    expect(q.sql).toContain('"org_id" = $1')
    expect(q.sql).toContain('"created_at" >= $2')
    expect(q.params).toEqual([42, '2026-07-01T00:00:00.000Z'])
  })

  it('getMonthlyApiGenerations (the billing count) still filters on high_confidence', async () => {
    rowsFor.push({ match: 'count(*)', rows: [[4]] })
    const { getMonthlyApiGenerations } = await queries()
    const n = await getMonthlyApiGenerations(42, new Date('2026-07-01T00:00:00.000Z'))

    expect(n).toBe(4)
    // Guards the inverse mistake: the two counts must not collapse into one, or
    // low-confidence answers start billing as deflections.
    expect(calls[0].sql).toContain('high_confidence')
  })

  it('getApiGenerationsByKey groups by key_id and stays org-scoped', async () => {
    rowsFor.push({ match: 'group by', rows: [[7, '5'], [null, '2']] })
    const { getApiGenerationsByKey } = await queries()
    const rows = await getApiGenerationsByKey(42, new Date('2026-07-01T00:00:00.000Z'))

    const [q] = calls
    expect(q.sql).toContain('group by "api_generations"."key_id"')
    expect(q.sql).toContain('"org_id" = $1')
    expect(q.params[0]).toBe(42)
    // Counts come back from postgres as strings; the caller charts them.
    expect(rows).toEqual([
      { keyId: 7, calls: 5 },
      { keyId: null, calls: 2 },
    ])
  })

  it('every api_generations read is filtered by org id — no cross-tenant leak', async () => {
    rowsFor.push({ match: 'count(*)', rows: [[0]] })
    const { getMonthlyApiGenerations, getMonthlyApiGenerationAttempts, getApiGenerationsByKey } =
      await queries()
    const start = new Date('2026-07-01T00:00:00.000Z')
    await getMonthlyApiGenerations(42, start)
    await getMonthlyApiGenerationAttempts(42, start)
    await getApiGenerationsByKey(42, start)

    expect(calls.length).toBe(3)
    for (const c of calls) {
      expect(c.sql, c.sql).toContain('"api_generations"."org_id" = $1')
      expect(c.params[0]).toBe(42)
    }
  })
})

// ---------------------------------------------------------------------------
// Schema <-> migration agreement
// ---------------------------------------------------------------------------

describe('lib/db/schema: api_generations.key_id matches the migration', () => {
  it('declares a nullable integer key_id column', async () => {
    const { apiGenerations } = await import('@/lib/db/schema')
    const col = getTableConfig(apiGenerations).columns.find((c) => c.name === 'key_id')
    expect(col, 'key_id column missing from the Drizzle table').toBeDefined()
    expect(col!.getSQLType()).toBe('integer')
    // Nullable by design: pre-migration rows have no key, and a key row can be
    // deleted without destroying the historical usage record.
    expect(col!.notNull).toBe(false)
  })

  it('points key_id at api_keys(id), the same target the migration declares', async () => {
    const { apiGenerations } = await import('@/lib/db/schema')
    const fk = getTableConfig(apiGenerations).foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === 'key_id')
    )
    expect(fk, 'key_id has no foreign key in the Drizzle table').toBeDefined()
    const ref = fk!.reference()
    expect(ref.foreignTable[Symbol.for('drizzle:Name') as never]).toBe('api_keys')
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(['id'])
    expect(readMigration()).toMatch(/REFERENCES\s+api_keys\s*\(\s*id\s*\)/i)
  })

  it('declares idx_api_generations_key on key_id, with the migration creating the same name', async () => {
    const { apiGenerations } = await import('@/lib/db/schema')
    const idx = getTableConfig(apiGenerations).indexes.find(
      (i) => i.config.name === 'idx_api_generations_key'
    )
    expect(idx, 'idx_api_generations_key missing from the Drizzle table').toBeDefined()
    expect(idx!.config.columns.map((c) => (c as { name: string }).name)).toEqual(['key_id'])
    // A schema-only index never reaches the database: drizzle-kit push is not
    // part of this repo's deploy path, the hand-written SQL is.
    expect(readMigration()).toMatch(
      /CREATE INDEX IF NOT EXISTS\s+idx_api_generations_key\s+ON\s+api_generations\s*\(\s*key_id\s*\)/i
    )
  })
})

// ---------------------------------------------------------------------------
// Migration file + runner pickup
// ---------------------------------------------------------------------------

describe(`drizzle/${MIGRATION}`, () => {
  it('exists and is non-empty', () => {
    expect(readMigration().trim().length).toBeGreaterThan(0)
  })

  it('adds key_id to api_generations without a NOT NULL that would fail on existing rows', () => {
    const sql = readMigration()
    expect(sql).toMatch(
      /ALTER TABLE\s+api_generations\s+ADD COLUMN IF NOT EXISTS\s+key_id\s+integer/i
    )
    expect(sql).not.toMatch(/key_id[^;]*NOT NULL/i)
  })

  it('every statement is idempotent, because the runner replays whole files', () => {
    // lib/db/migrate.ts splits a file only on "--> statement-breakpoint" and
    // executes each chunk as one db.execute. This file has no breakpoints, so
    // both statements go out together: if the ALTER succeeded on a previous
    // partial run and the CREATE INDEX had not, a non-idempotent ALTER would
    // abort the chunk forever. IF NOT EXISTS on both keeps replay safe.
    const statements = readMigration()
      .replace(/--[^\n]*/g, '') // strip comments first: they contain semicolons
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(statements.length).toBe(2)
    for (const stmt of statements) {
      expect(stmt, stmt).toMatch(/IF NOT EXISTS/i)
    }
  })

  it('is discovered by the custom runner and sorts after every earlier migration', () => {
    // Mirrors lib/db/migrate.ts: readdir -> keep *.sql -> sort by filename.
    const files = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(files).toContain(MIGRATION)
    const idx = files.indexOf(MIGRATION)
    expect(files.slice(0, idx).every((f) => f < MIGRATION)).toBe(true)
    // api_keys must already exist when the FK is added.
    const apiKeysMigration = files.find((f) => fs
      .readFileSync(path.join(DRIZZLE_DIR, f), 'utf-8')
      .match(/CREATE TABLE (IF NOT EXISTS )?api_keys/i))
    expect(apiKeysMigration, 'no migration creates api_keys').toBeDefined()
    expect(apiKeysMigration! < MIGRATION).toBe(true)
  })

  it('has a unique numeric prefix, so sort order is deterministic', () => {
    const prefix = MIGRATION.slice(0, 4)
    const clashes = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql') && f.startsWith(prefix))
    expect(clashes).toEqual([MIGRATION])
  })

  it('is a hand-written migration, so it must not be registered in the drizzle journal', () => {
    // migrate.ts exists precisely because journal-based migrate() skips these.
    // A stray journal entry would make drizzle-kit try to own the file too.
    const journal = JSON.parse(
      fs.readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf-8')
    ) as { entries: { tag: string }[] }
    expect(journal.entries.map((e) => e.tag)).not.toContain(MIGRATION.replace('.sql', ''))
  })

  it('the runner treats "column already exists" as a skip, keeping re-runs green', () => {
    // 42701 is what postgres raises for a duplicate ADD COLUMN. Without it in
    // ALREADY_EXISTS a redeploy against an already-migrated DB throws.
    const src = readFileAt('lib/db/migrate.ts')
    expect(src).toContain("'42701'")
    expect(src).toContain("'42P07'")
    expect(src).toContain('ALREADY_EXISTS.has(code)')
  })
})

// ---------------------------------------------------------------------------
// TRUST_PROXY_HOPS documentation
// ---------------------------------------------------------------------------

describe('TRUST_PROXY_HOPS is documented everywhere env vars are listed', () => {
  it('is read by lib/http/client-ip.ts', () => {
    expect(readFileAt('lib/http/client-ip.ts')).toContain('process.env.TRUST_PROXY_HOPS')
  })

  it.each([
    'content/docs/reference/environment-variables.mdx',
  ])('appears in %s with its default called out', (file) => {
    const doc = readFileAt(file)
    expect(doc, `${file} never mentions TRUST_PROXY_HOPS`).toContain('TRUST_PROXY_HOPS')
    // An operator behind two proxies needs to know the default is 1, otherwise
    // every request lands in one shared rate-limit bucket.
    const at = doc.indexOf('TRUST_PROXY_HOPS')
    const near = doc.slice(Math.max(0, at - 600), at + 600)
    expect(near, `${file} does not state the default`).toMatch(/defaults? to/i)
  })

  it('is not a secret, so it belongs in the committed example env unredacted', () => {
    expect(readFileAt('.env.example')).toMatch(/TRUST_PROXY_HOPS=\d+/)
  })
})
