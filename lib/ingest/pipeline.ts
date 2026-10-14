import { after } from 'next/server'
import { triageMessage } from '@/lib/ai/triage'
import { NoAIProviderConfiguredError, type ModelPurpose } from '@/lib/ai/models'
import { createTicket, getTicketBySourceMessageId, getTicketByThreadId, recordCustomerReply, updateTicketTriage } from '@/lib/db/queries/tickets'
import { createNotification } from '@/lib/db/queries/notifications'
import { calculateDeadlines, checkSlaBreaches } from '@/lib/sla/engine'
import { sendPushToAll } from '@/lib/push/notify'
import { sendNewTicketEmail, sendSlaBreachEmails } from '@/lib/email/send'
import { runAIAgent } from '@/lib/ai/agent'
import { sendKeepAlive } from '@/lib/channels/post-reply'
import { embedText, EMBEDDING_MODEL } from '@/lib/ai/embed'
import { findRelated, isDuplicate } from '@/lib/ai/related'
import { saveEmbedding, getCandidateVectors, replaceLinks, getPriorAnswers } from '@/lib/db/queries/embeddings'
import { getKBContext } from '@/lib/db/queries/kb'
import { orgHasAIKey } from '@/lib/db/queries/ai-config'
import { reservePlatformKeyTrial } from '@/lib/billing/platform-key-trial'
import { getDeploymentMode } from '@/lib/billing/plans'
import { logger } from '@/lib/logger'
import { isUniqueViolation } from '@/lib/ingest/db-errors'
import { clampIngestContent } from '@/lib/ingest/limits'
import { withRetry } from '@/lib/retry'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'
import type { Priority, Ticket } from '@/types'

export type Platform = 'discord' | 'slack' | 'telegram' | 'email' | 'github' | 'mcp' | 'google_chat' | 'discourse' | 'circle'

export interface MessagePayload {
  messageId: string
  content: string
  authorId: string
  authorName: string
  guildId?: string
  channelId: string
  threadId?: string
  platform?: Platform
  // Precomputed deep link back to the original message — only Slack needs
  // this resolved by the caller (chat.getPermalink, while the bot token is
  // in hand); other platforms construct their link from stored IDs at
  // render time instead. See tickets.source_url in lib/db/schema.ts.
  sourceUrl?: string
  // API-created tickets have no live channel acknowledgement to protect, so
  // their caller can wait for the draft pipeline and receive a fully
  // enriched ticket instead of observing the initial placeholder state.
  waitForEnrichment?: boolean
}

export interface PipelineResult {
  ticket_id: number
  duplicate?: boolean
  // True when this message was a reply inside an existing thread and got
  // appended to that ticket instead of creating a new one. Distinct from
  // `duplicate` (the exact same message id seen twice) — this is a genuinely
  // new message, just one that continues an existing conversation.
  appended?: boolean
}

const MOD = 'ingest/pipeline'

function severityToPriority(score: number): Priority {
  if (score >= 0.9) return 'critical'
  if (score >= 0.6) return 'high'
  if (score >= 0.3) return 'medium'
  return 'low'
}

export async function processCommunityMessage(
  payload: MessagePayload,
  orgId: number
): Promise<PipelineResult> {
  const { messageId, authorId, authorName, guildId, channelId, threadId, platform = 'discord', sourceUrl } = payload
  // Bounded once here so every entry point (and the embedding call that
  // follows) works from the same limit regardless of what the caller sent.
  const content = clampIngestContent(payload.content)

  const existing = await getTicketBySourceMessageId(messageId, orgId)
  if (existing) {
    logger.debug('duplicate message — skipping', { module: MOD, ticketId: existing.id, messageId })
    return { ticket_id: existing.id, duplicate: true }
  }

  // A reply inside an existing thread continues that ticket instead of
  // fragmenting into a new one — same reasoning as email's reply threading
  // (recordCustomerReply), generalized here to any platform that surfaces a
  // thread id (Discord threads, Slack thread_ts today). Deliberately does
  // NOT re-run the AI agent on a reply, for the same reason email doesn't:
  // re-triaging and re-answering every follow-up message in a live back-
  // and-forth would be costly and could post a stale or repetitive answer
  // into an ongoing human conversation. A staff notification is enough —
  // a human decides whether a fresh AI answer makes sense.
  if (threadId) {
    const threadTicket = await getTicketByThreadId(threadId, orgId)
    if (threadTicket) {
      await recordCustomerReply(threadTicket.id, content)
      await createNotification(
        'new_question',
        `${authorName} replied to ticket #${threadTicket.org_ticket_number}`,
        threadTicket.id,
        orgId
      )
      // See sendKeepAlive's doc comment (lib/channels/post-reply.ts) — Google
      // Chat's UI flags the app as "not responding" for this silence too, so
      // it gets the same neutral, content-free receipt as the deflections-off
      // paths in lib/ai/agent.ts. Every other platform no-ops here.
      await sendKeepAlive(platform, threadId, orgId)
      logger.info('thread reply appended to existing ticket', {
        module: MOD, ticketId: threadTicket.id, threadId, platform,
      })
      return { ticket_id: threadTicket.id, appended: true }
    }
  }

  // A new org with no AI provider configured gets a taste of full AI
  // processing before requiring their own key: atomically reserve one of
  // its 5 lifetime free platform-key trial tickets (self-hosted deployments
  // never need this — their "platform key" is already the self-hoster's own
  // .env, see platformKeyAllowed in lib/ai/models.ts). Reserved once per
  // ticket, here, not once per model call — triage, embedding, drafting, and
  // confidence-grading all reuse the same decision instead of racing 3
  // separate reservations for what is really one ticket's worth of trial.
  let aiPurpose: ModelPurpose = 'production'
  if (getDeploymentMode() !== 'self-hosted' && !(await orgHasAIKey(orgId))) {
    const grantedTrial = await reservePlatformKeyTrial(orgId)
    if (grantedTrial) aiPurpose = 'trial'
  }

  // Triage is an LLM call — too slow to sit in front of an inbound webhook's
  // ack. Discord/Slack require a sub-few-second response or they retry the
  // event. (Google Chat's "not responding" placeholder turned out to be
  // triggered by the shape of the synchronous response, not its latency —
  // see the ack built in app/api/google-chat/events/route.ts — but keeping
  // triage out of this path is still correct for Discord/Slack's real
  // timing requirement.) Create the ticket with an untriaged placeholder
  // immediately (same shape the no-AI-provider fallback already used
  // permanently — see runBackgroundEnrichment below) and run real triage as
  // the first step of background enrichment, correcting the ticket in place
  // once it finishes via updateTicketTriage.
  const { text: contentText, attachments } = parseAttachmentLines(content)
  const placeholderSummary =
    contentText.slice(0, 200) || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
  const placeholderPriority: Priority = 'medium'
  const { sla_response_deadline, sla_resolve_deadline } = await calculateDeadlines(placeholderPriority, orgId)

  let ticket: Ticket
  try {
    ticket = await createTicket({
      source_message_id: messageId,
      discord_guild_id: guildId,
      source_channel_id: channelId,
      source_thread_id: threadId,
      source_author_id: authorId,
      source_author_name: authorName,
      source_url: sourceUrl,
      source_platform: platform,
      content,
      category: 'general_question',
      severity_score: 0.3,
      ai_summary: placeholderSummary,
      ai_suggested_priority: placeholderPriority,
      priority: placeholderPriority,
      sla_response_deadline: sla_response_deadline ?? undefined,
      sla_resolve_deadline: sla_resolve_deadline ?? undefined,
    }, orgId)
  } catch (err) {
    // Two deliveries of the same message can both pass the lookup above; the
    // (org_id, source_message_id) unique index lets exactly one insert win and
    // the other is reported as the duplicate it is.
    if (isUniqueViolation(err)) {
      const winner = await getTicketBySourceMessageId(messageId, orgId)
      if (winner) {
        logger.debug('duplicate message — lost insert race', { module: MOD, ticketId: winner.id, messageId })
        return { ticket_id: winner.id, duplicate: true }
      }
    }
    throw err
  }

  logger.info('ticket created', { module: MOD, ticketId: ticket.id, orgId, platform })

  if (payload.waitForEnrichment) {
    await runBackgroundEnrichment(ticket, orgId, aiPurpose)
  } else {
    after(() => runBackgroundEnrichment(ticket, orgId, aiPurpose))
  }

  return { ticket_id: ticket.id }
}

// Embeddings, duplicate detection, prior-answer lookup, and the AI agent —
// everything that can safely run after the ticket already exists and the
// caller has moved on. Normally scheduled via next/server's after() from
// processCommunityMessage above, but deliberately a standalone function so
// the stuck-ticket retry sweep (app/api/ingest/retry-stuck/route.ts) can
// call it directly, synchronously, outside of any after() scheduling —
// see GitHub issue #222: this job has been observed to silently never run
// for some messages under rapid concurrent ingestion, with zero error
// logged anywhere, which after()'s own semantics give no way to detect or
// recover from at the call site. The retry path re-derives every input
// this function needs from the ticket row itself (content, author name,
// channel/thread ids, platform, category/summary) rather than from
// pipeline-local closure variables, so it works identically whether it's
// running immediately after ticket creation or minutes later from a sweep.
export async function runBackgroundEnrichment(
  ticket: Ticket,
  orgId: number,
  aiPurpose: ModelPurpose
): Promise<void> {
  const { id: ticketId, content, org_ticket_number: orgTicketNumber } = ticket
  const authorName = ticket.source_author_name ?? 'Unknown'
  const platform = ticket.source_platform
  const channelId = ticket.source_channel_id ?? ''
  const threadId = ticket.source_thread_id ?? undefined

  // Ticket was created synchronously with an untriaged placeholder (see
  // processCommunityMessage) — real triage runs here, first, so everything
  // below (the notification, the AI agent's category param) uses the real
  // classification rather than the placeholder.
  let category = ticket.category ?? 'general_question'
  let summary = ticket.ai_summary ?? (content ?? '').slice(0, 200)
  let priority = ticket.priority
  let severityScore = ticket.severity_score

  try {
    const t0 = Date.now()
    try {
      const triage = await withRetry(() => triageMessage(content, orgId, aiPurpose), 'triage', { module: MOD })
      priority = severityToPriority(triage.severity_score)
      const { sla_response_deadline, sla_resolve_deadline } = await calculateDeadlines(priority, orgId)
      await updateTicketTriage(ticketId, {
        category: triage.category,
        severity_score: triage.severity_score,
        ai_summary: triage.summary,
        ai_suggested_priority: triage.suggested_priority,
        priority,
        sla_response_deadline,
        sla_resolve_deadline,
      })
      category = triage.category
      summary = triage.summary
      severityScore = triage.severity_score
      logger.info('triage complete', {
        module: MOD, orgId, ticketId, category, priority, severity: triage.severity_score, durationMs: Date.now() - t0,
      })
    } catch (err) {
      // A missing provider is expected and permanent for this org — the
      // ticket keeps its placeholder triage, same as before this refactor.
      // Any other error (a transient LLM failure withRetry couldn't recover
      // from) is unexpected; it's logged by the outer catch below and the
      // ticket is left with its placeholder rather than blocking the rest
      // of enrichment.
      if (!(err instanceof NoAIProviderConfiguredError)) throw err
      logger.warn('no AI provider configured — leaving ticket untriaged', { module: MOD, orgId, ticketId })
    }

    await createNotification(
      'new_question',
      `New ${category.replace('_', ' ')} from ${authorName}: ${summary}`,
      ticketId,
      orgId
    )

    // Notifications — non-blocking failures
    try {
      await sendPushToAll({
        title: 'New Community Question',
        body: `${authorName}: ${summary}`,
        url: `/tickets/${orgTicketNumber}`,
      }, orgId)
    } catch (err) {
      logger.warn('push notification failed', { module: MOD, ticketId, error: err })
    }

    try {
      // sendNewTicketEmail gates on `.priority` and quotes `.ai_summary` —
      // both would still read the placeholder values off the original
      // `ticket` object here, since only the DB row and the local variables
      // above were corrected by the triage update. Pass a ticket reflecting
      // the real triage result so the critical/high-priority alert email
      // actually fires when it should.
      await sendNewTicketEmail({ ...ticket, category, ai_summary: summary, priority, severity_score: severityScore }, orgId)
    } catch (err) {
      logger.warn('new ticket email failed', { module: MOD, ticketId, error: err })
    }

    try {
      const breached = await checkSlaBreaches(orgId)
      await sendSlaBreachEmails(breached, orgId)
    } catch (err) {
      logger.warn('SLA breach check/email failed', { module: MOD, ticketId, error: err })
    }

    // Semantic enrichment
    let priorAnswers: { summary: string; answer: string }[] = []
    let duplicates: ReturnType<typeof findRelated> = []
    try {
      const t1 = Date.now()
      const vector = await withRetry(
        () => embedText(`${summary}\n\n${clampIngestContent(content)}`, orgId, aiPurpose),
        'embed',
        { module: MOD, ticketId }
      )
      await saveEmbedding(ticketId, vector, EMBEDDING_MODEL)
      logger.info('embedding saved', { module: MOD, ticketId, durationMs: Date.now() - t1 })

      const candidates = await getCandidateVectors(ticketId, orgId)
      const related = findRelated(vector, candidates)
      await replaceLinks(ticketId, related)
      logger.debug('related links updated', { module: MOD, ticketId, relatedCount: related.length })

      duplicates = related.filter((m) => isDuplicate(m.score))
      if (duplicates.length > 0) {
        logger.info('possible duplicate detected', { module: MOD, ticketId, duplicateCount: duplicates.length })
        await createNotification(
          'new_question',
          `Possible duplicate (asked ${duplicates.length + 1}×): ${summary}`,
          ticketId,
          orgId
        )
      }

      priorAnswers = [
        ...await getKBContext(vector, 3, orgId),
        ...await getPriorAnswers(related.map((m) => m.related_id), orgId),
      ]
      logger.debug('prior answers loaded', { module: MOD, ticketId, count: priorAnswers.length })
    } catch (err) {
      logger.error('semantic enrichment failed', { module: MOD, ticketId, error: err })
    }

    // AI agent
    await withRetry(
      () => runAIAgent(ticketId, content, threadId ?? channelId, priorAnswers, orgId, platform, category ?? 'general_question', duplicates, orgTicketNumber, aiPurpose, channelId, threadId),
      'AI agent',
      { module: MOD, ticketId }
    )
  } catch (err) {
    logger.error('background enrichment job failed unexpectedly', { module: MOD, ticketId, error: err })
  }
}
