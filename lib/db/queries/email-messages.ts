import { eq, and, inArray, desc, gte } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { emailMessages } from '../schema'

export type EmailMessageStatus =
  | 'received'
  | 'processed'
  | 'rejected_spam'
  | 'rejected_loop'
  | 'rejected_filter'
  | 'sent'
  | 'bounced'
  | 'delivery_failed'

interface EmailMessage {
  id: number
  org_id: number
  direction: 'in' | 'out'
  rfc_message_id: string
  provider_message_id: string | null
  in_reply_to: string | null
  references: string | null
  ticket_id: number | null
  from_addr: string | null
  to_addr: string | null
  subject: string | null
  spam_verdict: string | null
  status: EmailMessageStatus
  created_at: string
}

function toEmailMessage(row: typeof emailMessages.$inferSelect): EmailMessage {
  return {
    id: row.id,
    org_id: row.orgId,
    direction: row.direction as 'in' | 'out',
    rfc_message_id: row.rfcMessageId,
    provider_message_id: row.providerMessageId,
    in_reply_to: row.inReplyTo,
    references: row.references,
    ticket_id: row.ticketId,
    from_addr: row.fromAddr,
    to_addr: row.toAddr,
    subject: row.subject,
    spam_verdict: row.spamVerdict,
    status: row.status as EmailMessageStatus,
    created_at: row.createdAt,
  }
}

/**
 * Idempotency gate: insert the inbound message keyed on its RFC Message-ID.
 * Returns the created row, or null when the message was already recorded
 * (webhook retry / duplicate delivery) — callers stop processing on null.
 */
export async function recordInboundEmail(input: {
  orgId: number
  rfcMessageId: string
  inReplyTo?: string | null
  references?: string | null
  fromAddr?: string | null
  toAddr?: string | null
  subject?: string | null
  spamVerdict?: string | null
  rawPayload?: unknown
}): Promise<EmailMessage | null> {
  const [row] = await getDb()
    .insert(emailMessages)
    .values({
      orgId: input.orgId,
      direction: 'in',
      rfcMessageId: input.rfcMessageId,
      inReplyTo: input.inReplyTo ?? null,
      references: input.references ?? null,
      fromAddr: input.fromAddr ?? null,
      toAddr: input.toAddr ?? null,
      subject: input.subject ?? null,
      spamVerdict: input.spamVerdict ?? null,
      status: 'received',
      rawPayload: input.rawPayload ?? null,
    })
    .onConflictDoNothing({ target: [emailMessages.orgId, emailMessages.rfcMessageId] })
    .returning()
  return row ? toEmailMessage(row) : null
}

export async function recordOutboundEmail(input: {
  orgId: number
  rfcMessageId: string
  providerMessageId?: string | null
  inReplyTo?: string | null
  references?: string | null
  ticketId?: number | null
  fromAddr?: string | null
  toAddr?: string | null
  subject?: string | null
}): Promise<void> {
  await getDb()
    .insert(emailMessages)
    .values({
      orgId: input.orgId,
      direction: 'out',
      rfcMessageId: input.rfcMessageId,
      providerMessageId: input.providerMessageId ?? null,
      inReplyTo: input.inReplyTo ?? null,
      references: input.references ?? null,
      ticketId: input.ticketId ?? null,
      fromAddr: input.fromAddr ?? null,
      toAddr: input.toAddr ?? null,
      subject: input.subject ?? null,
      status: 'sent',
    })
    .onConflictDoNothing({ target: [emailMessages.orgId, emailMessages.rfcMessageId] })
}

/** Delivery-status webhooks reference Resend's own id — update by that, not our RFC id. */
export async function markStatusByProviderMessageId(
  providerMessageId: string,
  status: EmailMessageStatus
): Promise<void> {
  await getDb()
    .update(emailMessages)
    .set({ status })
    .where(eq(emailMessages.providerMessageId, providerMessageId))
}

export async function updateEmailMessageStatus(
  id: number,
  status: EmailMessageStatus
): Promise<void> {
  await getDb().update(emailMessages).set({ status }).where(eq(emailMessages.id, id))
}

export async function setEmailMessageTicket(id: number, ticketId: number): Promise<void> {
  await getDb().update(emailMessages).set({ ticketId }).where(eq(emailMessages.id, id))
}

/**
 * Threading resolution: given the Message-IDs a reply claims to be responding
 * to (its In-Reply-To plus every id in its References chain), find the ticket
 * of any message we've seen with one of those ids — in either direction.
 * Org-scoped: a Message-ID from another org's thread must never match.
 */
export async function findTicketByMessageIds(
  messageIds: string[],
  orgId: number
): Promise<number | null> {
  const ids = messageIds.filter(Boolean)
  if (ids.length === 0) return null
  const [row] = await getDb()
    .select({ ticketId: emailMessages.ticketId })
    .from(emailMessages)
    .where(
      and(
        inArray(emailMessages.rfcMessageId, ids),
        eq(emailMessages.orgId, orgId)
      )
    )
    .orderBy(desc(emailMessages.createdAt))
    .limit(1)
  return row?.ticketId ?? null
}

/** Latest inbound row for a ticket — supplies subject + Message-ID chain for replies. */
export async function getLatestInboundForTicket(
  ticketId: number,
  orgId: number
): Promise<EmailMessage | null> {
  const [row] = await getDb()
    .select()
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.ticketId, ticketId),
        eq(emailMessages.orgId, orgId),
        eq(emailMessages.direction, 'in')
      )
    )
    .orderBy(desc(emailMessages.createdAt))
    .limit(1)
  return row ? toEmailMessage(row) : null
}

/** All messages linked to a ticket (ticket detail: follow-ups, delivery state, attachments). */
export async function getEmailMessagesForTicket(
  ticketId: number,
  orgId: number
): Promise<EmailMessage[]> {
  const rows = await getDb()
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.ticketId, ticketId), eq(emailMessages.orgId, orgId)))
    .orderBy(desc(emailMessages.createdAt))
  return rows.map(toEmailMessage)
}

/** Count recent outbound replies to a sender — the loop-guard backstop throttle. */
export async function countRecentOutboundToSender(
  orgId: number,
  toAddr: string,
  sinceIso: string
): Promise<number> {
  // created_at is ISO text — lexicographic gte matches chronological order.
  const rows = await getDb()
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.orgId, orgId),
        eq(emailMessages.direction, 'out'),
        eq(emailMessages.toAddr, toAddr),
        gte(emailMessages.createdAt, sinceIso)
      )
    )
  return rows.length
}
