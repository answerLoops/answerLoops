'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { requireOrgAccess } from '@/lib/auth/org'
import { logger } from '@/lib/logger'
import { getTicketById } from '@/lib/db/queries/tickets'
import { countArticles, createArticle, getArticleBySourceTicket } from '@/lib/db/queries/kb'
import { ArticleCapReachedError } from '@/lib/db/queries/kb-article-cap'
import { embedTextWithModel } from '@/lib/ai/embed'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { aiUnavailableMessage } from '@/lib/ai/errors'
import { MAX_ARTICLES_PER_ORG } from '@/lib/kb/limits'
import { rateLimitShared } from '@/lib/ratelimit'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

const TicketIdSchema = z.coerce.number().int().positive()
const PromoteSchema = z.object({ ticketId: TicketIdSchema })

// Each add pays for an embedding call and goes live immediately, so bound how
// fast one workspace can add articles by hand. Generous for a person typing.
// Promoting a ticket and writing an article by hand share this budget.
const ADD_KNOWLEDGE_MAX = 30
const ADD_KNOWLEDGE_WINDOW_MS = 10 * 60_000

const LIMIT_MESSAGE = 'You are adding knowledge too quickly. Try again in a few minutes.'

/** The question and answer a ticket would contribute as an article. */
function draftFromTicket(ticket: NonNullable<Awaited<ReturnType<typeof getTicketById>>>): {
  question: string
  answer: string
} {
  const answer = ticket.resolution_notes || ticket.ai_draft || ''
  const question =
    ticket.ai_summary ??
    (() => {
      const { text, attachments } = parseAttachmentLines(ticket.content)
      return text.slice(0, 200) || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
    })()
  return { question, answer }
}

/**
 * Publishes a resolved ticket's answer as a knowledge-base article. It goes
 * live immediately, so, like writing an article by hand, it is limited to
 * owners and admins and shares that action's rate limit and article cap.
 */
export async function promoteToKBAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const parsed = PromoteSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid input' }

  const ticket = await getTicketById(parsed.data.ticketId, orgId)
  if (!ticket) return { error: 'Ticket not found' }
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    return { error: 'Only resolved tickets can be promoted' }
  }

  const { question, answer } = draftFromTicket(ticket)
  if (!answer) return { error: 'Ticket has no answer to promote' }

  if (await getArticleBySourceTicket(ticket.id, orgId)) {
    return { error: 'This ticket is already in the knowledge base' }
  }

  const limit = await rateLimitShared(`kb-add:${orgId}`, ADD_KNOWLEDGE_MAX, ADD_KNOWLEDGE_WINDOW_MS)
  if (!limit.ok) return { error: LIMIT_MESSAGE }

  if ((await countArticles(orgId)) >= MAX_ARTICLES_PER_ORG) {
    return { error: `Your knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before adding more.` }
  }

  try {
    const { embedding, model } = await embedTextWithModel(`${question}\n\n${answer}`, orgId)
    await createArticle({ question, answer, embedding, model, sourceTicketId: ticket.id }, orgId, MAX_ARTICLES_PER_ORG)
  } catch (err) {
    if (err instanceof ArticleCapReachedError) return { error: `Your knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before adding more.` }
    if (err instanceof NoAIProviderConfiguredError) {
      return { error: aiUnavailableMessage(err, 'Connect an AI provider in Settings → AI Model first, so new articles can be made searchable.') }
    }
    logger.error('failed to promote ticket to knowledge base', { module: 'actions/kb', orgId, error: err })
    return { error: 'Could not add this answer to the knowledge base. Try again.' }
  }

  refresh()
  return null
}

export type TicketDraftState =
  | { ok: true; ticketId: number; question: string; answer: string }
  | { ok: false; error: string }

/**
 * The starting text for an article written from a ticket (the "+ KB" link on
 * the Knowledge Gaps page). Org-scoped and limited to owners and admins, the
 * people who can publish the result.
 */
export async function getTicketDraftAction(rawTicketId: unknown): Promise<TicketDraftState> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { ok: false, error: access.error }

  const id = TicketIdSchema.safeParse(rawTicketId)
  if (!id.success) return { ok: false, error: 'Invalid ticket' }

  const ticket = await getTicketById(id.data, access.orgId)
  if (!ticket) return { ok: false, error: 'Ticket not found' }
  if (await getArticleBySourceTicket(ticket.id, access.orgId)) {
    return { ok: false, error: 'This ticket is already in the knowledge base' }
  }

  const { question, answer } = draftFromTicket(ticket)
  return { ok: true, ticketId: ticket.id, question: question.slice(0, 500), answer: answer.slice(0, 8000) }
}

const AddKnowledgeSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Add a question or title')
    .max(500, 'The question or title is too long (500 characters at most)'),
  answer: z
    .string()
    .trim()
    .min(1, 'Add the answer or context')
    .max(8000, 'The answer is too long (8,000 characters at most)'),
})

export type AddKnowledgeState = { error: string } | { ok: true; articleId: number } | null

/**
 * Adds an article straight to the knowledge base from the dashboard, so the
 * team can give the assistant context it was never going to learn from a
 * ticket. It is published immediately with no review step, so — like approving
 * a review-queue item — it is limited to owners and admins.
 */
export async function addKnowledgeAction(
  _prevState: unknown,
  formData: FormData
): Promise<AddKnowledgeState> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const parsed = AddKnowledgeSchema.safeParse({
    question: formData.get('question'),
    answer: formData.get('answer'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { question, answer } = parsed.data

  // An article written from a ticket is linked to it, which is what closes the
  // gap on the Knowledge Gaps page.
  let sourceTicketId: number | undefined
  const rawSourceTicket = formData.get('sourceTicketId')
  if (typeof rawSourceTicket === 'string' && rawSourceTicket !== '') {
    const id = TicketIdSchema.safeParse(rawSourceTicket)
    if (!id.success) return { error: 'Invalid ticket' }
    const ticket = await getTicketById(id.data, orgId)
    if (!ticket) return { error: 'Ticket not found' }
    if (await getArticleBySourceTicket(ticket.id, orgId)) {
      return { error: 'This ticket is already in the knowledge base' }
    }
    sourceTicketId = ticket.id
  }

  const limit = await rateLimitShared(`kb-add:${orgId}`, ADD_KNOWLEDGE_MAX, ADD_KNOWLEDGE_WINDOW_MS)
  if (!limit.ok) return { error: LIMIT_MESSAGE }

  if ((await countArticles(orgId)) >= MAX_ARTICLES_PER_ORG) {
    return { error: `Your knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before adding more.` }
  }

  try {
    // Same `question\n\nanswer` convention as promote-to-KB, file upload and
    // review-queue approval.
    const { embedding, model } = await embedTextWithModel(`${question}\n\n${answer}`, orgId)
    const article = await createArticle({ question, answer, embedding, model, ...(sourceTicketId !== undefined ? { sourceTicketId } : {}) }, orgId, MAX_ARTICLES_PER_ORG)
    refresh()
    return { ok: true, articleId: article.id }
  } catch (err) {
    if (err instanceof ArticleCapReachedError) return { error: `Your knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before adding more.` }
    if (err instanceof NoAIProviderConfiguredError) {
      return { error: aiUnavailableMessage(err, 'Connect an AI provider in Settings → AI Model first, so new articles can be made searchable.') }
    }
    logger.error('failed to add knowledge article', { module: 'actions/kb', orgId, error: err })
    return { error: 'Could not add this to the knowledge base. Try again.' }
  }
}
