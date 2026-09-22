'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import {
  updateTicketStatus,
  addTicketReply,
  updateTicketAIDraftStatus,
} from '@/lib/db/queries/tickets'
import { postReply, postReplyToGithub } from '@/lib/channels/post-reply'
import { getTicketById } from '@/lib/db/queries/tickets'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { sendTicketResolvedEmail } from '@/lib/email/send'
import { logger } from '@/lib/logger'

// Single per-platform dispatch for every reply this file sends — the manual
// staff reply box, and both the approve/edit draft actions. Previously each
// had its own hand-rolled (and differently incomplete — e.g. approve only
// ever sent for GitHub) switch; this replaces all three with the same
// shared module lib/ai/agent.ts's auto-deflect path already uses.
async function sendReply(
  ticket: NonNullable<Awaited<ReturnType<typeof getTicketById>>>,
  content: string,
  orgId: number
): Promise<string | null> {
  if (ticket.source_platform === 'github') {
    if (!ticket.source_channel_id || !ticket.source_message_id) return null
    return postReplyToGithub(ticket.source_channel_id, ticket.source_message_id, content, orgId)
  }
  // MCP tickets have no live channel to post into — source_channel_id holds
  // the synthetic messageId from create_ticket, which would otherwise look
  // "present" and trigger a doomed live API call.
  if (ticket.source_platform === 'mcp') return null
  // Circle is ingest-only (stage 1) — the reviewer copies the answer into
  // Circle by hand. Approve/edit still records the draft; nothing is sent.
  if (ticket.source_platform === 'circle') return null
  const channelId = ticket.source_thread_id ?? ticket.source_channel_id
  if (!channelId) return null
  return postReply(
    channelId,
    content,
    orgId,
    ticket.source_platform,
    ticket.id,
    ticket.source_channel_id ?? undefined, // slackChannelId — the real channel, separate from channelId above when in a thread
    ticket.source_thread_id ?? undefined   // slackThreadTs
  )
}

const UpdateStatusSchema = z.object({
  ticketId: z.coerce.number(),
  status: z.enum(['open', 'in_progress', 'resolved', 'closed', 'duplicate']),
  staffName: z.string().min(1).max(100),
  resolutionNotes: z.string().optional(),
})

export async function updateTicketStatusAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const parsed = UpdateStatusSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.status?.[0] ?? 'Invalid input' }
  }

  const { ticketId, status, staffName, resolutionNotes } = parsed.data

  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const owned = await getTicketById(ticketId, orgId)
  if (!owned) return { error: 'Ticket not found' }

  try {
    await updateTicketStatus(ticketId, status, staffName, resolutionNotes)
  } catch (err) {
    return { error: String(err) }
  }

  if (status === 'resolved' || status === 'closed') {
    const ticket = await getTicketById(ticketId, orgId)
    if (ticket) {
      sendTicketResolvedEmail(ticket, staffName, orgId).catch((err) =>
        logger.error('sendTicketResolvedEmail failed', { module: 'actions/tickets', error: err })
      )
    }
  }

  refresh()
  return null
}

const PostReplySchema = z.object({
  ticketId: z.coerce.number(),
  staffName: z.string().min(1).max(100),
  content: z.string().min(1).max(2000),
})

export async function postReplyAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const parsed = PostReplySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: 'Invalid input' }
  }

  const { ticketId, staffName, content } = parsed.data
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const ticket = await getTicketById(ticketId, orgId)
  if (!ticket) return { error: 'Ticket not found' }

  // Message format differs slightly per platform, matching what each one
  // looked like before this dispatch was unified — preserved intentionally.
  const message = ticket.source_platform === 'github'
    ? `**[${staffName}]:** ${content}`
    : ticket.source_platform === 'google_chat'
      ? `[Response from ${staffName}]: ${content}`
      : `**[Response from ${staffName}]:** ${content}`

  const postedMessageId = await sendReply(ticket, message, orgId).catch((err) => {
    logger.warn('failed to post reply', { module: 'actions/tickets', platform: ticket.source_platform, error: err })
    return null
  })

  // Save reply
  await addTicketReply(ticketId, staffName, content, postedMessageId ?? undefined)

  refresh()
  return null
}

const UpdateDraftSchema = z.object({
  ticketId: z.coerce.number(),
  action: z.enum(['approve', 'override', 'edit']),
  newDraft: z.string().optional(),
})

export async function updateAIDraftAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const parsed = UpdateDraftSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid input' }

  const { ticketId, action, newDraft } = parsed.data
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const ticket = await getTicketById(ticketId, orgId)
  if (!ticket) return { error: 'Ticket not found' }

  if (action === 'approve') {
    await updateTicketAIDraftStatus(ticketId, 'approved')
    // Post the approved draft to every platform, not just GitHub — this was
    // previously GitHub-only, silently sending nothing everywhere else.
    // Posted as-is (no "[Approved]" wrapper), matching how an auto-deflected
    // answer looks to the customer — an approved draft and an auto-answer
    // should read identically on the other end.
    if (ticket.ai_draft) {
      await sendReply(ticket, ticket.ai_draft, orgId).catch((err) => {
        logger.warn('failed to post approved draft', { module: 'actions/tickets', platform: ticket.source_platform, error: err })
        return null
      })
    }
  } else if (action === 'override') {
    await updateTicketAIDraftStatus(ticketId, 'overridden')
  } else if (action === 'edit' && newDraft) {
    await updateTicketAIDraftStatus(ticketId, 'approved', newDraft)
    // Message format differs slightly per platform, matching what each one
    // looked like before this dispatch was unified — preserved intentionally.
    const message = ticket.source_platform === 'github'
      ? newDraft
      : ticket.source_platform === 'google_chat'
        ? `[Updated AI Answer]\n${newDraft}`
        : `**[Updated AI Answer]**\n${newDraft}`
    await sendReply(ticket, message, orgId).catch((err) => {
      logger.warn('failed to post edited draft', { module: 'actions/tickets', platform: ticket.source_platform, error: err })
      return null
    })
  }

  refresh()
  return null
}
