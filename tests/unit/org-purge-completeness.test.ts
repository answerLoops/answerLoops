import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'

/**
 * Guardrail for a real production bug: `hardPurgeOrg` deletes org data table
 * by table, by hand. Three tables (`email_domains`, `email_oauth_connections`,
 * `org_feature_flags`) were added to the schema over time and never wired into
 * it. Because every one of them declares `org_id ... REFERENCES orgs(id)` with
 * no `ON DELETE` clause, Postgres defaults the constraint to NO ACTION — so
 * `tx.delete(orgs)` raised a foreign-key violation, and since the whole purge
 * is one transaction, *nothing* was deleted. The sweep in bot/index.ts catches
 * and logs that failure per-org and retries on the next pass, so it never
 * surfaced: affected orgs simply stayed soft-deleted forever, with
 * `email_oauth_connections` still holding live encrypted mailbox refresh
 * tokens for a customer who had asked to be deleted.
 *
 * The only prior guard was `expect(deleteCalls.length).toBeGreaterThan(15)`
 * against an actual 27 — a floor that could never trip.
 *
 * This test derives the expected table list from the schema itself, so adding
 * an org-scoped table forces a deliberate decision: wire it into the purge, or
 * add it to EXEMPT below with a reason.
 */

const ORG_FK_COLUMN = 'org_id'

// Tables that carry org_id but deliberately are NOT purged. Each needs a
// reason — this list is the "deliberate decision" half of the guard, and an
// entry added without justification defeats the point of the test.
const EXEMPT = new Map<string, string>([
  [
    'trial_claims',
    'The one-trial-per-person ledger. It must survive workspace and account deletion or a ' +
      'deleted account could start another trial. It holds a SHA-256 of the normalized ' +
      'email and the sign-in provider account id, never the address; org_id and user_id ' +
      'are ON DELETE SET NULL, so the purge neither blocks on it nor leaves a link to the org.',
  ],
  [
    'rate_limit_buckets',
    'Ephemeral abuse-control counters keyed by an opaque string, not customer data. ' +
      'Self-expiring via its own cleanup sweep, and no FK to orgs, so it neither blocks ' +
      'the delete nor retains anything meaningful about the org.',
  ],
])

describe('hardPurgeOrg deletes every org-scoped table', () => {
  it('has no org-scoped table missing from the purge', async () => {
    const schema = await import('@/lib/db/schema')

    // `schema` also exports non-table constants (DEFAULT_ORG_ID etc.), so widen
    // to unknown before narrowing — otherwise the predicate isn't assignable.
    const orgScopedTables = (Object.values(schema) as unknown[])
      .filter((v): v is PgTable => is(v, PgTable))
      .map((t) => getTableConfig(t))
      .filter((cfg) => cfg.columns.some((c) => c.name === ORG_FK_COLUMN))
      .map((cfg) => cfg.name)

    // Sanity: if this ever collapses to a handful, the filter above broke and
    // the test would start passing vacuously.
    expect(orgScopedTables.length).toBeGreaterThan(20)

    const src = fs.readFileSync(
      path.join(process.cwd(), 'lib/db/queries/orgs.ts'),
      'utf-8',
    )
    const purgeBody = src.slice(src.indexOf('export async function hardPurgeOrg'))

    // Map the Drizzle export name back to its SQL table name so we can look
    // for `tx.delete(<exportName>)` — the purge is written against the
    // TypeScript identifiers, not the SQL names.
    const exportNameByTableName = new Map<string, string>()
    for (const [exportName, value] of Object.entries(schema)) {
      if (is(value, PgTable)) exportNameByTableName.set(getTableConfig(value).name, exportName)
    }

    const missing = orgScopedTables.filter((tableName) => {
      if (EXEMPT.has(tableName)) return false
      const exportName = exportNameByTableName.get(tableName)
      if (!exportName) return true
      return !purgeBody.includes(`delete(${exportName})`)
    })

    expect(
      missing,
      `These tables carry ${ORG_FK_COLUMN} but are never deleted in hardPurgeOrg. ` +
        `If a table genuinely should survive org deletion, add it to EXEMPT with a reason. ` +
        `Otherwise a customer's data outlives their account — and if the table has an ` +
        `org_id FK without ON DELETE, the purge transaction fails outright and nothing ` +
        `is deleted at all.`,
    ).toEqual([])
  })

  it('every EXEMPT entry still exists in the schema', async () => {
    // Stops the exemption list from silently accumulating dead entries that
    // would mask a genuinely unpurged table if a name were ever reused.
    const schema = await import('@/lib/db/schema')
    const allTableNames = new Set(
      (Object.values(schema) as unknown[])
        .filter((v): v is PgTable => is(v, PgTable))
        .map((t) => getTableConfig(t).name),
    )
    for (const name of EXEMPT.keys()) {
      expect(allTableNames.has(name), `EXEMPT lists "${name}", which no longer exists`).toBe(true)
    }
  })

  it('purges widget chat transcripts, which live outside the Drizzle schema', () => {
    // lib/ai/memory.ts stores widget conversations in Mastra-managed tables
    // (mastra_threads / mastra_messages). They carry no org_id column, so the
    // schema-derived check above is structurally blind to them — the org is
    // encoded in the thread id (`widget:<orgId>:<visitorId>`) instead.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'lib/db/queries/orgs.ts'),
      'utf-8',
    )
    const purgeBody = src.slice(src.indexOf('export async function hardPurgeOrg'))

    expect(purgeBody).toContain('mastra_messages')
    expect(purgeBody).toContain('mastra_threads')
    // Scoped to this org, never a bare unscoped DELETE.
    expect(purgeBody).toMatch(/widget:\$\{orgId\}:/)
    // Guarded, because Mastra creates these lazily: an unguarded DELETE against
    // a non-existent table aborts the transaction and purges nothing.
    expect(purgeBody).toContain('to_regclass')
  })
})
