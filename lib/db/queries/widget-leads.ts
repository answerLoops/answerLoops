import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { widgetLeads } from '../schema'

interface WidgetLead {
  id: number
  orgId: number
  widgetToken: string
  email: string
  question: string | null
  createdAt: string
}

function toLead(row: typeof widgetLeads.$inferSelect): WidgetLead {
  return {
    id: row.id,
    orgId: row.orgId,
    widgetToken: row.widgetToken,
    email: row.email,
    question: row.question,
    createdAt: row.createdAt,
  }
}

/**
 * @param question The question the visitor couldn't get answered, when this
 *   lead came from the on-failure prompt. Omit (or pass undefined) for an
 *   up-front-gate lead, collected before any question exists.
 *
 * A repeat submission from the same org+email never creates a second row, but
 * it does fill in a question the existing row doesn't have yet — so a visitor
 * who left their email at the up-front gate and later submits it again through
 * the on-failure prompt still gets their question recorded. An existing
 * question is never overwritten.
 */
export async function saveWidgetLead(
  orgId: number,
  widgetToken: string,
  email: string,
  question?: string
): Promise<{ isNew: boolean }> {
  // xmax is 0 on a row this statement just inserted and non-zero on one the
  // conflict clause updated, which is how a first submission is told apart from
  // a repeat without a second query.
  const rows = await getDb()
    .insert(widgetLeads)
    .values({ orgId, widgetToken, email, question: question ?? null })
    .onConflictDoUpdate({
      target: [widgetLeads.orgId, widgetLeads.email],
      set: { question: sql`coalesce(${widgetLeads.question}, excluded.question)` },
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` })
  return { isNew: rows[0]?.inserted === true }
}

/** The id of the lead saved for this workspace and (already normalised) address, or null. */
export async function getWidgetLeadId(orgId: number, email: string): Promise<number | null> {
  const [row] = await getDb()
    .select({ id: widgetLeads.id })
    .from(widgetLeads)
    .where(and(eq(widgetLeads.orgId, orgId), eq(widgetLeads.email, email)))
    .limit(1)
  return row?.id ?? null
}

/** A lead that has not been included in an email to the team yet. */
export interface PendingWidgetLead {
  id: number
  email: string
  question: string | null
  createdAt: string
}

/**
 * Leads still waiting to be emailed for a workspace, oldest first. The first
 * `limit` are listed and `total` says how many there are in all. `maxId` is the highest id seen, so that only leads up
 * to it are marked as sent afterwards and one that arrives in between waits for
 * the next email.
 */
export async function listPendingWidgetLeads(
  orgId: number,
  limit: number
): Promise<{ leads: PendingWidgetLead[]; total: number; maxId: number }> {
  const db = getDb()
  const rows = await db
    .select({
      id: widgetLeads.id,
      email: widgetLeads.email,
      question: widgetLeads.question,
      createdAt: widgetLeads.createdAt,
    })
    .from(widgetLeads)
    .where(and(eq(widgetLeads.orgId, orgId), isNull(widgetLeads.notifiedAt)))
    .orderBy(asc(widgetLeads.id))
    .limit(limit)
  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      maxId: sql<number>`coalesce(max(${widgetLeads.id}), 0)::int`,
    })
    .from(widgetLeads)
    .where(and(eq(widgetLeads.orgId, orgId), isNull(widgetLeads.notifiedAt)))
  return { leads: rows, total: agg?.total ?? 0, maxId: agg?.maxId ?? 0 }
}

/** Marks a workspace's pending leads up to `maxId` as included in an email. */
export async function markWidgetLeadsNotified(orgId: number, maxId: number): Promise<void> {
  await getDb()
    .update(widgetLeads)
    .set({ notifiedAt: sql`now()` })
    .where(and(eq(widgetLeads.orgId, orgId), isNull(widgetLeads.notifiedAt), lte(widgetLeads.id, maxId)))
}

/**
 * Takes the workspace's turn to send a lead email, if the last one was at least
 * `windowMinutes` ago (or there has never been one). One conditional UPDATE, so
 * two requests arriving together cannot both win: the second waits for the
 * first, re-reads the row and finds the window already used.
 */
export async function claimWidgetLeadEmailWindow(orgId: number, windowMinutes: number): Promise<boolean> {
  const rows = (await getDb().execute(sql`
    UPDATE orgs SET widget_leads_emailed_at = now()
    WHERE id = ${orgId}
      AND (widget_leads_emailed_at IS NULL
           OR widget_leads_emailed_at < now() - make_interval(mins => ${windowMinutes}))
    RETURNING id
  `)) as unknown as { id: number }[]
  return rows.length > 0
}

/**
 * Workspaces that have leads waiting and whose window has closed, for the
 * periodic sweep that sends the grouped email.
 */
export async function listOrgsWithPendingWidgetLeads(windowMinutes: number, limit: number): Promise<number[]> {
  const rows = (await getDb().execute(sql`
    SELECT DISTINCT l.org_id
    FROM widget_leads l
    JOIN orgs o ON o.id = l.org_id
    WHERE l.notified_at IS NULL
      AND (o.widget_leads_emailed_at IS NULL
           OR o.widget_leads_emailed_at < now() - make_interval(mins => ${windowMinutes}))
    LIMIT ${limit}
  `)) as unknown as { org_id: number }[]
  return rows.map((r) => r.org_id)
}

export async function listWidgetLeads(orgId: number): Promise<WidgetLead[]> {
  const rows = await getDb()
    .select()
    .from(widgetLeads)
    .where(eq(widgetLeads.orgId, orgId))
    .orderBy(desc(widgetLeads.createdAt))
  return rows.map(toLead)
}
