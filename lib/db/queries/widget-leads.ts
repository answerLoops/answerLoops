import { desc, eq } from 'drizzle-orm'
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
 * onConflictDoNothing means a repeat submission from the same org+email never
 * updates an existing row's question — the unique index below predates this
 * field and that dedupe behaviour isn't being changed here, so the question
 * attached is whichever submission happened to land first.
 */
export async function saveWidgetLead(
  orgId: number,
  widgetToken: string,
  email: string,
  question?: string
): Promise<void> {
  await getDb()
    .insert(widgetLeads)
    .values({ orgId, widgetToken, email, question: question ?? null })
    .onConflictDoNothing()
}

export async function listWidgetLeads(orgId: number): Promise<WidgetLead[]> {
  const rows = await getDb()
    .select()
    .from(widgetLeads)
    .where(eq(widgetLeads.orgId, orgId))
    .orderBy(desc(widgetLeads.createdAt))
  return rows.map(toLead)
}
