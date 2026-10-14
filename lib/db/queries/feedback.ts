import { eq, and, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { ticketFeedback, answerMessages, tickets, aiAssessments } from '../schema'
import type { FeedbackSource, FeedbackSummary, FeedbackVote } from '@/types'

export async function saveFeedback(input: {
  ticketId: number
  source: FeedbackSource
  vote: FeedbackVote
  actor: string
}): Promise<void> {
  await getDb()
    .insert(ticketFeedback)
    .values({
      ticketId: input.ticketId,
      source: input.source,
      vote: input.vote,
      actor: input.actor,
    })
    .onConflictDoUpdate({
      target: [ticketFeedback.ticketId, ticketFeedback.source, ticketFeedback.actor],
      set: { vote: input.vote, updatedAt: new Date().toISOString() },
    })
}

export async function getFeedbackSummary(ticketId: number): Promise<FeedbackSummary> {
  const rows = await getDb()
    .select({ vote: ticketFeedback.vote })
    .from(ticketFeedback)
    .where(eq(ticketFeedback.ticketId, ticketId))

  const up = rows.filter((r) => r.vote === 'up').length
  const down = rows.filter((r) => r.vote === 'down').length

  const [staff] = await getDb()
    .select({ vote: ticketFeedback.vote })
    .from(ticketFeedback)
    .where(and(eq(ticketFeedback.ticketId, ticketId), eq(ticketFeedback.source, 'staff')))
    .limit(1)

  return { up, down, staffVote: staff?.vote as FeedbackVote ?? null }
}

/**
 * Ticket behind a posted AI answer message, restricted to the given org.
 * Returns null for an unknown message and for one that belongs to a
 * different org.
 */
export async function getTicketIdByAnswerMessage(messageId: string, orgId: number): Promise<number | null> {
  const [row] = await getDb()
    .select({ ticketId: answerMessages.ticketId })
    .from(answerMessages)
    .innerJoin(tickets, eq(tickets.id, answerMessages.ticketId))
    .where(and(eq(answerMessages.discordMessageId, messageId), eq(tickets.orgId, orgId)))
    .limit(1)
  return row?.ticketId ?? null
}

export async function mapAnswerMessage(discordMessageId: string, ticketId: number): Promise<void> {
  await getDb()
    .insert(answerMessages)
    .values({ discordMessageId, ticketId })
    .onConflictDoUpdate({
      target: answerMessages.discordMessageId,
      set: { ticketId },
      // Only re-point a mapping that belongs to the same org as the new ticket.
      setWhere: sql`(SELECT org_id FROM tickets WHERE id = ${answerMessages.ticketId}) = (SELECT org_id FROM tickets WHERE id = ${ticketId})`,
    })
}

export async function getDeflectionAccuracyByCategory(orgId: number): Promise<{
  category: string
  deflected: number
  positive: number
  negative: number
}[]> {
  const rows = await getDb().execute(sql`
    SELECT t.category AS category,
           COUNT(*) AS deflected,
           SUM(CASE WHEN f.net > 0 THEN 1 ELSE 0 END) AS positive,
           SUM(CASE WHEN f.net < 0 THEN 1 ELSE 0 END) AS negative
    FROM ai_assessments a
    JOIN tickets t ON t.id = a.ticket_id
    LEFT JOIN (
      SELECT ticket_id,
             SUM(CASE WHEN vote = 'up' THEN 1 ELSE -1 END) AS net
      FROM ticket_feedback GROUP BY ticket_id
    ) f ON f.ticket_id = a.ticket_id
    WHERE a.auto_deflected = 1
      AND t.org_id = ${orgId}
    GROUP BY t.category
  `)
  return rows as unknown as { category: string; deflected: number; positive: number; negative: number }[]
}
