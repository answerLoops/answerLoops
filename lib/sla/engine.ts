import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { getSLAConfig } from '@/lib/db/queries/sla'
import type { Priority } from '@/types'

export async function calculateDeadlines(priority: Priority, createdAt: Date = new Date()) {
  const config = await getSLAConfig(priority)
  if (!config) {
    return { sla_response_deadline: null, sla_resolve_deadline: null }
  }

  const responseDeadline = new Date(createdAt.getTime() + config.response_hours * 3_600_000)
  const resolveDeadline = new Date(createdAt.getTime() + config.resolve_hours * 3_600_000)

  return {
    sla_response_deadline: responseDeadline.toISOString(),
    sla_resolve_deadline: resolveDeadline.toISOString(),
  }
}

export interface SlaBreachedTicket {
  id: number
  org_ticket_number: number
}

export async function checkSlaBreaches(orgId: number): Promise<SlaBreachedTicket[]> {
  const db = getDb()
  const now = new Date().toISOString()

  await db.execute(sql`
    UPDATE tickets
    SET sla_response_met = 0, updated_at = ${now}
    WHERE org_id = ${orgId}
      AND status = 'open'
      AND sla_response_deadline IS NOT NULL
      AND sla_response_deadline < ${now}
      AND sla_response_met IS NULL
  `)

  await db.execute(sql`
    UPDATE tickets
    SET sla_resolve_met = 0, updated_at = ${now}
    WHERE org_id = ${orgId}
      AND status NOT IN ('resolved', 'closed', 'duplicate')
      AND sla_resolve_deadline IS NOT NULL
      AND sla_resolve_deadline < ${now}
      AND sla_resolve_met IS NULL
  `)

  const cutoff = new Date(Date.now() - 60_000).toISOString()
  const rows = await db.execute(sql`
    SELECT id, org_ticket_number FROM tickets
    WHERE org_id = ${orgId}
      AND (sla_response_met = 0 OR sla_resolve_met = 0)
      AND updated_at > ${cutoff}
  `)
  return (rows as unknown as { id: number; org_ticket_number: number }[]).map((r) => ({
    id: r.id,
    org_ticket_number: r.org_ticket_number,
  }))
}

export function getSLAStatus(ticket: {
  sla_response_deadline: string | null
  sla_resolve_deadline: string | null
  sla_response_met: 0 | 1 | null
  sla_resolve_met: 0 | 1 | null
  status: string
}) {
  const now = new Date()

  const responseBreached =
    ticket.sla_response_met === 0 ||
    (ticket.sla_response_met === null &&
      ticket.sla_response_deadline !== null &&
      new Date(ticket.sla_response_deadline) < now &&
      ticket.status === 'open')

  const resolveBreached =
    ticket.sla_resolve_met === 0 ||
    (ticket.sla_resolve_met === null &&
      ticket.sla_resolve_deadline !== null &&
      new Date(ticket.sla_resolve_deadline) < now &&
      !['resolved', 'closed', 'duplicate'].includes(ticket.status))

  const responseDeadlineMs =
    ticket.sla_response_deadline ? new Date(ticket.sla_response_deadline).getTime() - now.getTime() : null

  const resolveDeadlineMs =
    ticket.sla_resolve_deadline ? new Date(ticket.sla_resolve_deadline).getTime() - now.getTime() : null

  return {
    responseBreached,
    resolveBreached,
    anyBreached: responseBreached || resolveBreached,
    responseRemainingMs: responseDeadlineMs,
    resolveRemainingMs: resolveDeadlineMs,
  }
}
