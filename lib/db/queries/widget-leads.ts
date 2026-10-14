import { desc, eq } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { widgetLeads } from '../schema'

interface WidgetLead {
  id: number
  orgId: number
  widgetToken: string
  email: string
  createdAt: string
}

function toLead(row: typeof widgetLeads.$inferSelect): WidgetLead {
  return {
    id: row.id,
    orgId: row.orgId,
    widgetToken: row.widgetToken,
    email: row.email,
    createdAt: row.createdAt,
  }
}

export async function saveWidgetLead(orgId: number, widgetToken: string, email: string): Promise<void> {
  await getDb()
    .insert(widgetLeads)
    .values({ orgId, widgetToken, email })
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

