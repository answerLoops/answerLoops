import { and, eq } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { csatMessages, csatRatings, tickets } from '../schema'
import { sql } from 'drizzle-orm'

export async function mapCsatMessage(messageId: string, ticketId: number): Promise<void> {
  await getDb()
    .insert(csatMessages)
    .values({ messageId, ticketId })
    .onConflictDoUpdate({
      target: csatMessages.messageId,
      set: { ticketId },
      // Only re-point a mapping that belongs to the same org as the new ticket.
      setWhere: sql`(SELECT org_id FROM tickets WHERE id = ${csatMessages.ticketId}) = (SELECT org_id FROM tickets WHERE id = ${ticketId})`,
    })
}

/**
 * Ticket behind a CSAT prompt message, restricted to the given org. Returns
 * null for an unknown message and for one that belongs to a different org.
 */
export async function getTicketIdByCsatMessage(messageId: string, orgId: number): Promise<number | null> {
  const [row] = await getDb()
    .select({ ticketId: csatMessages.ticketId })
    .from(csatMessages)
    .innerJoin(tickets, eq(tickets.id, csatMessages.ticketId))
    .where(and(eq(csatMessages.messageId, messageId), eq(tickets.orgId, orgId)))
    .limit(1)
  return row?.ticketId ?? null
}

export async function saveCsatRating(input: {
  ticketId: number
  orgId: number
  rating: number
  platform: string
}): Promise<void> {
  await getDb()
    .insert(csatRatings)
    .values({
      ticketId: input.ticketId,
      orgId: input.orgId,
      rating: input.rating,
      platform: input.platform,
    })
    .onConflictDoNothing()
}

interface CsatStats {
  avgRating: number | null
  totalRatings: number
  breakdown: { rating: number; count: number }[]
}

export async function getCsatStats(orgId: number): Promise<CsatStats> {
  const [agg] = await getDb().execute(sql`
    SELECT
      AVG(rating)::float AS avg_rating,
      COUNT(*)::int AS total_ratings
    FROM csat_ratings
    WHERE org_id = ${orgId}
  `)
  const rows = await getDb().execute(sql`
    SELECT rating, COUNT(*)::int AS count
    FROM csat_ratings
    WHERE org_id = ${orgId}
    GROUP BY rating
    ORDER BY rating
  `)
  const r = agg as Record<string, number | null>
  return {
    avgRating: r.avg_rating != null ? Math.round(Number(r.avg_rating) * 10) / 10 : null,
    totalRatings: Number(r.total_ratings ?? 0),
    breakdown: rows as unknown as { rating: number; count: number }[],
  }
}
