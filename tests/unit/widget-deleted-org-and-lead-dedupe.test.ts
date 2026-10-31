import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableConfig } from 'drizzle-orm/pg-core'

/**
 * Two properties that were silently unenforced on the public widget surface.
 *
 * 1. `getOrgByWidgetToken` filtered on token and expiry but never on
 *    `deleted_at`, so a customer who deleted their account kept a live widget
 *    for the entire 30-day purge grace period — still answering from their
 *    knowledge base, still spending against their AI provider, still writing
 *    rows into an org marked for deletion. `softDeleteOrg` is documented as
 *    revoking access the moment it is set, and auth.ts enforces exactly that
 *    for every authenticated path; the widget is unauthenticated, so nothing
 *    was applying it here.
 *
 * 2. `saveWidgetLead` deduped with `onConflictDoNothing`, but `widget_leads`
 *    had no unique constraint for it to conflict on — the only unique column
 *    was the serial primary key, which never collides. The dedupe was a no-op
 *    on a public write endpoint.
 *
 * The predicate case is asserted against compiled SQL rather than a returned
 * row, because the filtering happens in Postgres: a fake driver returning
 * whatever it is handed would pass even with the predicate removed.
 */

const { calls } = vi.hoisted(() => ({ calls: [] as { sql: string; params: unknown[] }[] }))

const fakeDb = drizzle(async (sql: string, params: unknown[]) => {
  calls.push({ sql, params })
  return { rows: [] }
})

vi.mock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))

beforeEach(() => {
  calls.length = 0
})

describe('getOrgByWidgetToken excludes soft-deleted orgs', () => {
  it('constrains on deleted_at being null', async () => {
    const { getOrgByWidgetToken } = await import('@/lib/db/queries/widgets')
    await getOrgByWidgetToken('a'.repeat(48))

    expect(calls).toHaveLength(1)
    const compiled = calls[0].sql.toLowerCase()
    expect(compiled).toContain('"deleted_at" is null')
    // The token predicate must survive alongside it — a widget token is the
    // only credential this endpoint has.
    expect(compiled).toContain('"widget_token" =')
  })

  it('binds the token as a parameter rather than interpolating it', async () => {
    const { getOrgByWidgetToken } = await import('@/lib/db/queries/widgets')
    const token = 'b'.repeat(48)
    await getOrgByWidgetToken(token)
    expect(calls[0].params).toContain(token)
    expect(calls[0].sql).not.toContain(token)
  })
})

describe('widget_leads can actually dedupe', () => {
  it('declares a unique index on (org_id, email)', async () => {
    const { widgetLeads } = await import('@/lib/db/schema')
    const cfg = getTableConfig(widgetLeads)

    const uniques = cfg.indexes.filter((i) => i.config.unique)
    const orgEmail = uniques.find((i) => {
      const cols = (i.config.columns ?? []).map((c) => (c as { name?: string }).name)
      return cols.includes('org_id') && cols.includes('email')
    })

    expect(
      orgEmail,
      'widget_leads has no unique index on (org_id, email) — saveWidgetLead calls ' +
        'onConflictDoNothing, which silently does nothing without one, so the same ' +
        'address can be inserted without limit from the public lead endpoint',
    ).toBeDefined()
  })

  it('scopes uniqueness per org, not globally by email', async () => {
    // The same person may legitimately be a lead for two different customers;
    // a global unique on email would drop the second one.
    const { widgetLeads } = await import('@/lib/db/schema')
    const cfg = getTableConfig(widgetLeads)
    const globalEmailUnique = cfg.indexes.find((i) => {
      const cols = (i.config.columns ?? []).map((c) => (c as { name?: string }).name)
      return i.config.unique && cols.length === 1 && cols[0] === 'email'
    })
    expect(globalEmailUnique).toBeUndefined()
  })

  it('conflicts on (org_id, email) so the constraint is actually used, and only ever fills in a missing question', async () => {
    const { saveWidgetLead } = await import('@/lib/db/queries/widget-leads')
    await saveWidgetLead(1, 'a'.repeat(48), 'lead@example.com', 'how do I export?')
    const sql = calls[0].sql.toLowerCase()
    expect(sql).toMatch(/on conflict \("org_id", ?"email"\) do update/)
    // coalesce(existing, incoming): an existing question is never overwritten,
    // but a row saved without one (the up-front gate) picks it up.
    expect(sql).toMatch(/coalesce\("widget_leads"\."question", excluded\.question\)/)
  })

  it('stores the optional question when provided, attaching the context the on-failure prompt collected', async () => {
    const { saveWidgetLead } = await import('@/lib/db/queries/widget-leads')
    await saveWidgetLead(1, 'a'.repeat(48), 'lead@example.com', 'how do I export my data?')
    expect(calls[0].params).toContain('how do I export my data?')
  })

  it('stores NULL for the question when omitted — an up-front-gate lead has none yet', async () => {
    const { saveWidgetLead } = await import('@/lib/db/queries/widget-leads')
    await saveWidgetLead(1, 'a'.repeat(48), 'lead@example.com')
    expect(calls[0].params).toContain(null)
  })
})
