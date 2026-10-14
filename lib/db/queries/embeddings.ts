import { and, eq, ne, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { ticketEmbeddings, ticketLinks, tickets, ticketFeedback } from '../schema'
import type { Candidate, Match } from '@/lib/ai/related'
import type { PriorAnswer, RelatedTicket } from '@/types'

export async function saveEmbedding(ticketId: number, vector: number[], model: string): Promise<void> {
  await getDb()
    .insert(ticketEmbeddings)
    .values({ ticketId, vector: JSON.stringify(vector), model })
    .onConflictDoUpdate({
      target: ticketEmbeddings.ticketId,
      set: { vector: JSON.stringify(vector), model },
    })
}

export async function getCandidateVectors(excludeTicketId: number, orgId: number): Promise<Candidate[]> {
  const rows = await getDb()
    .select({ ticket_id: ticketEmbeddings.ticketId, vector: ticketEmbeddings.vector })
    .from(ticketEmbeddings)
    .innerJoin(tickets, eq(tickets.id, ticketEmbeddings.ticketId))
    .where(and(
      ne(ticketEmbeddings.ticketId, excludeTicketId),
      eq(tickets.orgId, orgId),
      // Only vectors on the workspace's pinned embedding model, so a model
      // change never compares two vector spaces (lib/ai/embedding-pin.ts).
      sql`${ticketEmbeddings.model} = (SELECT embedding_model_in_use FROM orgs WHERE id = ${orgId})`,
    ))
  return rows.map((r) => ({ ticket_id: r.ticket_id, vector: JSON.parse(r.vector) as number[] }))
}

export async function replaceLinks(ticketId: number, matches: Match[]): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(ticketLinks).where(eq(ticketLinks.ticketId, ticketId))
    for (const m of matches) {
      await tx.insert(ticketLinks).values({
        ticketId,
        relatedId: m.related_id,
        score: m.score,
      })
    }
  })
}

export async function getRelatedTickets(ticketId: number, orgId: number): Promise<RelatedTicket[]> {
  const rows = await getDb().execute(sql`
    SELECT t.id,
           t.org_ticket_number,
           COALESCE(t.ai_summary, LEFT(t.content, 120)) AS summary,
           t.category, t.status, l.score, t.created_at
    FROM ticket_links l
    JOIN tickets t ON t.id = l.related_id
    WHERE l.ticket_id = ${ticketId}
      AND t.org_id = ${orgId}
    ORDER BY l.score DESC
  `)
  return rows as unknown as RelatedTicket[]
}

export async function getPriorAnswers(ticketIds: number[], orgId: number): Promise<PriorAnswer[]> {
  if (ticketIds.length === 0) return []
  const rows = await getDb().execute(sql`
    SELECT COALESCE(t.ai_summary, LEFT(t.content, 120)) AS summary,
           COALESCE(t.resolution_notes, t.ai_draft) AS answer
    FROM tickets t
    LEFT JOIN (
      SELECT ticket_id,
             SUM(CASE WHEN vote = 'up' THEN 1 ELSE -1 END) AS net
      FROM ticket_feedback GROUP BY ticket_id
    ) f ON f.ticket_id = t.id
    WHERE t.id = ANY(ARRAY[${sql.join(ticketIds.map(id => sql`${id}`), sql`, `)}]::int[])
      AND t.org_id = ${orgId}
      AND t.status IN ('resolved', 'closed')
      AND COALESCE(t.resolution_notes, t.ai_draft) IS NOT NULL
      AND COALESCE(f.net, 0) >= 0
    ORDER BY COALESCE(f.net, 0) DESC
  `)
  return rows as unknown as PriorAnswer[]
}
