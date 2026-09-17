import { eq, and, or, inArray, sql, desc, lt } from 'drizzle-orm'
import { getDb } from '../drizzle'
import {
  tickets,
  ticketReplies,
  ticketEvents,
  aiAssessments,
  orgs,
  notifications,
  ticketEmbeddings,
  ticketLinks,
  ticketFeedback,
  answerMessages,
  csatMessages,
  csatRatings,
  kbArticles,
} from '../schema'
import type { Ticket, CreateTicketInput, TicketFilters, TicketReply, TicketEvent } from '@/types'

function toTicket(row: typeof tickets.$inferSelect): Ticket {
  return {
    id: row.id,
    org_ticket_number: row.orgTicketNumber,
    source_message_id: row.sourceMessageId,
    discord_guild_id: row.discordGuildId,
    source_channel_id: row.sourceChannelId,
    source_thread_id: row.sourceThreadId,
    source_author_id: row.sourceAuthorId,
    source_author_name: row.sourceAuthorName,
    discord_deleted_at: row.discordDeletedAt ?? null,
    source_url: row.sourceUrl ?? null,
    source_platform: (row.sourcePlatform ?? 'discord') as Ticket['source_platform'],
    content: row.content,
    category: row.category as Ticket['category'],
    severity_score: row.severityScore,
    ai_summary: row.aiSummary,
    ai_suggested_priority: row.aiSuggestedPriority as Ticket['ai_suggested_priority'],
    ai_draft: row.aiDraft,
    ai_draft_status: row.aiDraftStatus as Ticket['ai_draft_status'],
    ai_draft_posted_at: row.aiDraftPostedAt,
    priority: row.priority as Ticket['priority'],
    status: row.status as Ticket['status'],
    resolution_notes: row.resolutionNotes,
    sla_response_deadline: row.slaResponseDeadline,
    sla_resolve_deadline: row.slaResolveDeadline,
    sla_response_met: row.slaResponseMet as Ticket['sla_response_met'],
    sla_resolve_met: row.slaResolveMet as Ticket['sla_resolve_met'],
    first_response_at: row.firstResponseAt,
    resolved_at: row.resolvedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function toReply(row: typeof ticketReplies.$inferSelect): TicketReply {
  return {
    id: row.id,
    ticket_id: row.ticketId,
    staff_name: row.staffName,
    content: row.content,
    discord_msg_id: row.discordMsgId,
    created_at: row.createdAt,
  }
}

function toEvent(row: typeof ticketEvents.$inferSelect): TicketEvent {
  return {
    id: row.id,
    ticket_id: row.ticketId,
    event_type: row.eventType,
    old_value: row.oldValue,
    new_value: row.newValue,
    actor: row.actor,
    created_at: row.createdAt,
  }
}

/**
 * Atomically assigns the next per-org ticket number. Race-safe on its own —
 * a single UPDATE...RETURNING is serialized by Postgres's row-level lock on
 * the org row, so two concurrent ticket creations for the same org can
 * never be handed the same number, no separate advisory lock needed.
 */
async function getNextOrgTicketNumber(orgId: number): Promise<number> {
  const [row] = await getDb()
    .update(orgs)
    .set({ nextTicketNumber: sql`${orgs.nextTicketNumber} + 1` })
    .where(eq(orgs.id, orgId))
    .returning({ next: orgs.nextTicketNumber })
  // A zero-row UPDATE (orgId doesn't exist — e.g. a caller resolved the
  // wrong or an unprovisioned org id) previously crashed here with an
  // opaque "Cannot read properties of undefined (reading 'next')", which
  // cost real time tracing back to "which org is missing" during a
  // production incident. Fail with that answer directly.
  if (!row) throw new Error(`getNextOrgTicketNumber: no org found with id ${orgId}`)
  return row.next - 1
}

export async function createTicket(input: CreateTicketInput, orgId: number): Promise<Ticket> {
  const db = getDb()
  const orgTicketNumber = await getNextOrgTicketNumber(orgId)
  const [row] = await db
    .insert(tickets)
    .values({
      orgId,
      orgTicketNumber,
      sourceMessageId: input.source_message_id ?? null,
      discordGuildId: input.discord_guild_id ?? null,
      sourceChannelId: input.source_channel_id ?? null,
      sourceThreadId: input.source_thread_id ?? null,
      sourceAuthorId: input.source_author_id ?? null,
      sourceAuthorName: input.source_author_name ?? null,
      sourceUrl: input.source_url ?? null,
      sourcePlatform: input.source_platform ?? 'discord',
      content: input.content,
      category: input.category ?? null,
      severityScore: input.severity_score ?? null,
      aiSummary: input.ai_summary ?? null,
      aiSuggestedPriority: input.ai_suggested_priority ?? null,
      priority: input.priority,
      slaResponseDeadline: input.sla_response_deadline ?? null,
      slaResolveDeadline: input.sla_resolve_deadline ?? null,
    })
    .returning()

  await db.insert(ticketEvents).values({ ticketId: row.id, eventType: 'created', actor: 'system' })

  return toTicket(row)
}

// Corrects a ticket's triage fields once real AI classification finishes —
// used by the ingest pipeline, which now creates tickets with an untriaged
// placeholder synchronously (to ack inbound webhooks fast: Discord/Slack
// require a sub-few-second response, and Google Chat's client shows a
// "not responding" placeholder the moment its own timeout fires) and runs
// the actual triage LLM call afterward in the background.
export async function updateTicketTriage(
  id: number,
  triage: {
    category: Ticket['category']
    severity_score: number
    ai_summary: string
    ai_suggested_priority: Ticket['ai_suggested_priority']
    priority: Ticket['priority']
    sla_response_deadline?: string | null
    sla_resolve_deadline?: string | null
  }
): Promise<void> {
  await getDb()
    .update(tickets)
    .set({
      category: triage.category,
      severityScore: triage.severity_score,
      aiSummary: triage.ai_summary,
      aiSuggestedPriority: triage.ai_suggested_priority,
      priority: triage.priority,
      slaResponseDeadline: triage.sla_response_deadline ?? null,
      slaResolveDeadline: triage.sla_resolve_deadline ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tickets.id, id))
}

/**
 * Keyset cursor into the `getTickets` ordering — (created_at, id) both desc.
 * `created_at` alone isn't unique enough to seek on: two tickets can share a
 * timestamp, and seeking on it alone would silently skip or repeat rows
 * across a page boundary. `id` (serial, insertion-ordered) breaks every tie.
 */
export interface TicketCursor {
  createdAt: string
  id: number
}

export async function getTickets(
  filters: TicketFilters = {},
  orgId: number,
  limit?: number,
  cursor?: TicketCursor
): Promise<Ticket[]> {
  const conditions = [eq(tickets.orgId, orgId)]
  if (filters.status) conditions.push(eq(tickets.status, filters.status))
  if (filters.priority) conditions.push(eq(tickets.priority, filters.priority))
  if (filters.category) conditions.push(eq(tickets.category, filters.category))
  // Strictly older than the cursor row on the same (created_at, id) ordering
  // the query sorts by, so a page picks up exactly where the previous one
  // stopped regardless of inserts/deletes elsewhere in the table.
  if (cursor) {
    conditions.push(
      or(
        lt(tickets.createdAt, cursor.createdAt),
        and(eq(tickets.createdAt, cursor.createdAt), lt(tickets.id, cursor.id))
      )!
    )
  }

  let query = getDb()
    .select()
    .from(tickets)
    .where(and(...conditions))
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .$dynamic()
  if (limit) query = query.limit(limit)

  const rows = await query
  return rows.map(toTicket)
}

export async function getTicketById(id: number, orgId: number): Promise<Ticket | null> {
  const [row] = await getDb()
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), eq(tickets.orgId, orgId)))
    .limit(1)
  return row ? toTicket(row) : null
}

// The URL/UI-facing lookup — org_ticket_number is the number users actually
// see ("#14"), unique per org (not globally), unlike the internal serial id.
export async function getTicketByOrgTicketNumber(orgTicketNumber: number, orgId: number): Promise<Ticket | null> {
  const [row] = await getDb()
    .select()
    .from(tickets)
    .where(and(eq(tickets.orgTicketNumber, orgTicketNumber), eq(tickets.orgId, orgId)))
    .limit(1)
  return row ? toTicket(row) : null
}

// Internal helper for mutations that run after the caller has already verified
// org ownership (or that run in trusted system paths like the ingest pipeline).
async function getTicketByIdUnscoped(id: number): Promise<Ticket | null> {
  const [row] = await getDb()
    .select()
    .from(tickets)
    .where(eq(tickets.id, id))
    .limit(1)
  return row ? toTicket(row) : null
}

export async function getTicketBySourceMessageId(messageId: string, orgId: number): Promise<Ticket | null> {
  const [row] = await getDb()
    .select()
    .from(tickets)
    .where(and(eq(tickets.sourceMessageId, messageId), eq(tickets.orgId, orgId)))
    .limit(1)
  return row ? toTicket(row) : null
}

// A reply's threadId is the ORIGINAL message's own id — Slack's thread_ts
// and Discord's thread channel id both work this way. That means the
// match has to cover two different columns depending on which ticket this
// is: sourceThreadId only gets populated on a ticket whose OWN message
// was already inside a thread (a reply to a reply, or a Discord message
// posted straight into an existing thread channel) — but the common case,
// a reply to a fresh top-level message, has to match against that
// original message's sourceMessageId instead, since the root ticket's
// sourceThreadId was never set (the root message had no thread_ts of its
// own at the time it was first ingested). Matching only sourceThreadId
// silently missed every "first reply to a top-level message" — the most
// common case — even on the webhook path, which otherwise receives every
// reply correctly.
export async function getTicketByThreadId(threadId: string, orgId: number): Promise<Ticket | null> {
  const [row] = await getDb()
    .select()
    .from(tickets)
    .where(and(
      or(eq(tickets.sourceThreadId, threadId), eq(tickets.sourceMessageId, threadId)),
      eq(tickets.orgId, orgId)
    ))
    .orderBy(desc(tickets.createdAt))
    .limit(1)
  return row ? toTicket(row) : null
}

export async function updateTicketAIDraft(id: number, draft: string): Promise<void> {
  const now = new Date().toISOString()
  const db = getDb()
  await db
    .update(tickets)
    .set({ aiDraft: draft, aiDraftStatus: 'posted', aiDraftPostedAt: now, updatedAt: now })
    .where(eq(tickets.id, id))

  await db.insert(ticketEvents).values({
    ticketId: id,
    eventType: 'ai_draft_posted',
    newValue: 'posted',
    actor: 'system',
  })
}

export async function updateTicketAIDraftStatus(id: number, status: string, newDraft?: string): Promise<void> {
  await getDb()
    .update(tickets)
    .set({
      aiDraftStatus: status,
      ...(newDraft !== undefined ? { aiDraft: newDraft } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tickets.id, id))
}

export async function updateTicketStatus(
  id: number,
  status: string,
  actor: string,
  resolutionNotes?: string
): Promise<void> {
  const ticket = await getTicketByIdUnscoped(id)
  if (!ticket) throw new Error('Ticket not found')

  const now = new Date().toISOString()
  const isFirstResponse = ticket.status === 'open' && status === 'in_progress'
  const isResolving = status === 'resolved' || status === 'closed'

  const update: Partial<typeof tickets.$inferInsert> = {
    status,
    updatedAt: now,
  }
  if (resolutionNotes) update.resolutionNotes = resolutionNotes
  if (isFirstResponse && !ticket.first_response_at) {
    update.firstResponseAt = now
    update.slaResponseMet =
      !ticket.sla_response_deadline || ticket.sla_response_deadline > now ? 1 : 0
  }
  if (isResolving) {
    update.resolvedAt = now
    update.slaResolveMet =
      !ticket.sla_resolve_deadline || ticket.sla_resolve_deadline > now ? 1 : 0
  }

  const db = getDb()
  await db.update(tickets).set(update).where(eq(tickets.id, id))
  await db.insert(ticketEvents).values({
    ticketId: id,
    eventType: 'status_changed',
    oldValue: ticket.status,
    newValue: status,
    actor,
  })
}

export async function addTicketReply(
  ticketId: number,
  staffName: string,
  content: string,
  discordMsgId?: string
): Promise<TicketReply> {
  const db = getDb()
  const [row] = await db
    .insert(ticketReplies)
    .values({ ticketId, staffName, content, discordMsgId: discordMsgId ?? null })
    .returning()

  const ticket = await getTicketByIdUnscoped(ticketId)
  if (ticket && ticket.status === 'open') {
    await updateTicketStatus(ticketId, 'in_progress', staffName)
  }

  await db.insert(ticketEvents).values({
    ticketId,
    eventType: 'replied',
    newValue: content.slice(0, 100),
    actor: staffName,
  })

  return toReply(row)
}

export async function getTicketReplies(ticketId: number): Promise<TicketReply[]> {
  const rows = await getDb()
    .select()
    .from(ticketReplies)
    .where(eq(ticketReplies.ticketId, ticketId))
    .orderBy(ticketReplies.createdAt)
  return rows.map(toReply)
}

export async function getTicketEvents(ticketId: number): Promise<TicketEvent[]> {
  const rows = await getDb()
    .select()
    .from(ticketEvents)
    .where(eq(ticketEvents.ticketId, ticketId))
    .orderBy(ticketEvents.createdAt)
  return rows.map(toEvent)
}

export async function getTicketStats(orgId: number) {
  const db = getDb()

  const [totRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(tickets)
    .where(eq(tickets.orgId, orgId))
  const [openRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), eq(tickets.status, 'open')))
  const [inProgressRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), eq(tickets.status, 'in_progress')))
  const [resolvedRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), inArray(tickets.status, ['resolved', 'closed'])))

  const [slaBreachRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM tickets
    WHERE (sla_response_met = 0 OR sla_resolve_met = 0) AND org_id = ${orgId}
  `)
  const [pendingRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(tickets)
    .where(
      and(eq(tickets.orgId, orgId), eq(tickets.aiDraftStatus, 'pending'), eq(tickets.status, 'open'))
    )
  const [needsReviewRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM tickets t
    JOIN ai_assessments a ON a.ticket_id = t.id
    WHERE a.auto_deflected = 0 AND t.status = 'open' AND t.org_id = ${orgId}
  `)
  const [deflectedRow] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM ai_assessments a
    JOIN tickets t ON t.id = a.ticket_id
    WHERE a.auto_deflected = 1 AND t.org_id = ${orgId}
  `)

  return {
    total: totRow?.n ?? 0,
    open: openRow?.n ?? 0,
    inProgress: inProgressRow?.n ?? 0,
    resolved: resolvedRow?.n ?? 0,
    slaBreaches: Number((slaBreachRow as Record<string, unknown>).n ?? 0),
    pendingDrafts: pendingRow?.n ?? 0,
    needsReview: Number((needsReviewRow as Record<string, unknown>).n ?? 0),
    autoDeflected: Number((deflectedRow as Record<string, unknown>).n ?? 0),
  }
}

export async function getSLABreachedTickets(orgId: number): Promise<Ticket[]> {
  const rows = await getDb().execute(sql`
    SELECT * FROM tickets
    WHERE (sla_response_met = 0 OR sla_resolve_met = 0)
      AND status NOT IN ('resolved', 'closed')
      AND org_id = ${orgId}
    ORDER BY created_at ASC
  `)
  return (rows as Record<string, unknown>[]).map((r) => r as unknown as Ticket)
}

// Safety net for GitHub issue #222: a ticket's after()-scheduled background
// job (embedding, AI draft, notifications) has been observed to silently
// never run for some messages under rapid concurrent ingestion — no error
// logged anywhere, no way to detect it at the call site. This finds
// candidates for the retry sweep in bot/index.ts. Best-effort discovery
// only — a slightly stale read here is fine, since claimStuckTicketForRetry
// below does the actual atomic claim right before any work happens.
// Bounded to the last 24h so a genuinely un-retryable ticket (repeatedly
// erroring, not just never-started) doesn't get retried forever.
export async function getStuckPendingTickets(thresholdMinutes: number): Promise<{ id: number; org_id: number }[]> {
  // created_at is stored as text (an ISO string, see lib/db/schema.ts), not
  // a native timestamp — cast it to timestamptz for comparison rather than
  // casting the computed side to text, which would compare Postgres's own
  // timestamptz-to-text format (space-separated, +00 offset) against JS's
  // toISOString() format (T-separated, Z suffix) and risk a wrong lexical
  // sort despite both representing the same instant.
  // Plain interval multiplication here, not a named-argument function call
  // — that combined with a bind parameter in the same argument position
  // broke this query in production (postgres.js mis-tokenizing it when
  // building the query from this sql-tagged template; no live-DB test had
  // ever exercised this query before, only a source-shape one). `n *
  // interval '1 minute'` has no equivalent ambiguity.
  const rows = await getDb().execute(sql`
    SELECT id, org_id FROM tickets
    WHERE ai_draft_status = 'pending'
      AND status = 'open'
      AND created_at::timestamptz < now() - (${thresholdMinutes} * interval '1 minute')
      AND created_at::timestamptz > now() - interval '24 hours'
    ORDER BY created_at ASC
    LIMIT 50
  `)
  return rows as unknown as { id: number; org_id: number }[]
}

// Atomically claims a stuck ticket for retry — single UPDATE...RETURNING,
// same race-safe pattern as getNextOrgTicketNumber/reservePlatformKeyTrial.
// Returns null if another process already claimed it, or if the original
// background job actually finished in the tiny window between the sweep's
// discovery read and this claim (ai_draft_status is no longer 'pending') —
// either way, null means "don't do the work, it's already handled."
export async function claimStuckTicketForRetry(id: number): Promise<Ticket | null> {
  const [row] = await getDb()
    .update(tickets)
    .set({ updatedAt: new Date().toISOString() })
    .where(and(eq(tickets.id, id), eq(tickets.aiDraftStatus, 'pending')))
    .returning()
  return row ? toTicket(row) : null
}

export async function markDiscordDeleted(sourceMessageId: string): Promise<void> {
  await getDb()
    .update(tickets)
    .set({ discordDeletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(tickets.sourceMessageId, sourceMessageId))
}

export async function markThreadDiscordDeleted(threadId: string): Promise<void> {
  await getDb()
    .update(tickets)
    .set({ discordDeletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(tickets.sourceThreadId, threadId))
}

/**
 * Record an inbound customer email reply as a follow-up on an existing ticket.
 * Reopens the ticket if it was resolved/closed — a reply means the issue
 * isn't actually done. System path (webhook ingest), so unscoped by design.
 */
export async function recordCustomerReply(ticketId: number, content: string): Promise<void> {
  const ticket = await getTicketByIdUnscoped(ticketId)
  if (!ticket) throw new Error('Ticket not found')

  const now = new Date().toISOString()
  const wasClosed = ticket.status === 'resolved' || ticket.status === 'closed'
  const db = getDb()

  if (wasClosed) {
    await db
      .update(tickets)
      .set({ status: 'open', updatedAt: now })
      .where(eq(tickets.id, ticketId))
  } else {
    await db.update(tickets).set({ updatedAt: now }).where(eq(tickets.id, ticketId))
  }

  await db.insert(ticketEvents).values({
    ticketId,
    eventType: 'customer_reply',
    oldValue: wasClosed ? ticket.status : null,
    newValue: wasClosed ? 'open' : null,
    actor: 'customer',
  })

  await db.insert(ticketReplies).values({
    ticketId,
    staffName: 'Customer',
    content,
  })
}

// Real bug found live: this only ever cleared 3 of the ~9 tables that
// reference a ticket with no cascade/set-null action at the DB level —
// notifications, ticket_embeddings, ticket_links (both its ticketId and
// relatedId columns, since a ticket can be the "related" side too),
// ticket_feedback, answer_messages, csat_messages, and csat_ratings were
// all missing. Any ticket that ever had a notification fired (effectively
// every ticket — one fires on creation alone) failed this call outright
// with a foreign-key violation, silently, from the dashboard's own Delete
// button — never actually deletable. Mirrors the dependency-safe order
// hardPurgeOrg (lib/db/queries/orgs.ts) already uses for org-wide deletion,
// scoped to a single ticket and wrapped in a transaction so a failure
// partway through can't leave some dependent rows deleted and others not.
// kb_articles.source_ticket_id is nullable and represents real KB content
// this ticket was promoted into — detached (set null), never deleted.
export async function deleteTicket(id: number): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.update(kbArticles).set({ sourceTicketId: null }).where(eq(kbArticles.sourceTicketId, id))
    await tx.delete(notifications).where(eq(notifications.ticketId, id))
    await tx.delete(ticketEmbeddings).where(eq(ticketEmbeddings.ticketId, id))
    await tx.delete(ticketLinks).where(eq(ticketLinks.ticketId, id))
    await tx.delete(ticketLinks).where(eq(ticketLinks.relatedId, id))
    await tx.delete(ticketFeedback).where(eq(ticketFeedback.ticketId, id))
    await tx.delete(answerMessages).where(eq(answerMessages.ticketId, id))
    await tx.delete(csatMessages).where(eq(csatMessages.ticketId, id))
    await tx.delete(csatRatings).where(eq(csatRatings.ticketId, id))
    await tx.delete(ticketReplies).where(eq(ticketReplies.ticketId, id))
    await tx.delete(ticketEvents).where(eq(ticketEvents.ticketId, id))
    await tx.delete(aiAssessments).where(eq(aiAssessments.ticketId, id))
    await tx.delete(tickets).where(eq(tickets.id, id))
  })
}
