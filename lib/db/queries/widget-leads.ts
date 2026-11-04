import { desc, eq, sql } from 'drizzle-orm'
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
): Promise<void> {
  await getDb()
    .insert(widgetLeads)
    .values({ orgId, widgetToken, email, question: question ?? null })
    .onConflictDoUpdate({
      target: [widgetLeads.orgId, widgetLeads.email],
      set: { question: sql`coalesce(${widgetLeads.question}, excluded.question)` },
    })
}

export async function listWidgetLeads(orgId: number): Promise<WidgetLead[]> {
  const rows = await getDb()
    .select()
    .from(widgetLeads)
    .where(eq(widgetLeads.orgId, orgId))
    .orderBy(desc(widgetLeads.createdAt))
  return rows.map(toLead)
}
