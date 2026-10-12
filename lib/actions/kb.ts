'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { auth } from '@/auth'
import { requireOrgAccess } from '@/lib/auth/org'
import { logger } from '@/lib/logger'
import { getTicketById } from '@/lib/db/queries/tickets'
import { countArticles, createArticle } from '@/lib/db/queries/kb'
import { embedText, EMBEDDING_MODEL } from '@/lib/ai/embed'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { MAX_ARTICLES_PER_ORG } from '@/lib/kb/limits'
import { rateLimitShared } from '@/lib/ratelimit'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

const PromoteSchema = z.object({ ticketId: z.coerce.number() })

export async function promoteToKBAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const parsed = PromoteSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid input' }

  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID

  const ticket = await getTicketById(parsed.data.ticketId, orgId)
  if (!ticket) return { error: 'Ticket not found' }
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    return { error: 'Only resolved tickets can be promoted' }
  }

  const answer = ticket.resolution_notes || ticket.ai_draft
  if (!answer) return { error: 'Ticket has no answer to promote' }
  const question = ticket.ai_summary ?? (() => {
    const { text, attachments } = parseAttachmentLines(ticket.content)
    return text.slice(0, 200) || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
  })()

  try {
    const embedding = await embedText(`${question}\n\n${answer}`, orgId)
    await createArticle({ question, answer, embedding, model: EMBEDDING_MODEL, sourceTicketId: ticket.id }, orgId)
  } catch (err) {
    return { error: String(err) }
  }

  refresh()
  return null
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

// Each add pays for an embedding call and goes live immediately, so bound how
// fast one workspace can add articles by hand. Generous for a person typing.
const ADD_KNOWLEDGE_MAX = 30
const ADD_KNOWLEDGE_WINDOW_MS = 10 * 60_000

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

  const limit = await rateLimitShared(`kb-add:${orgId}`, ADD_KNOWLEDGE_MAX, ADD_KNOWLEDGE_WINDOW_MS)
  if (!limit.ok) return { error: 'You are adding knowledge too quickly. Try again in a few minutes.' }

  if ((await countArticles(orgId)) >= MAX_ARTICLES_PER_ORG) {
    return { error: `Your knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before adding more.` }
  }

  try {
    // Same `question\n\nanswer` convention as promote-to-KB, file upload and
    // review-queue approval.
    const embedding = await embedText(`${question}\n\n${answer}`, orgId)
    const article = await createArticle({ question, answer, embedding, model: EMBEDDING_MODEL }, orgId)
    refresh()
    return { ok: true, articleId: article.id }
  } catch (err) {
    if (err instanceof NoAIProviderConfiguredError) {
      return { error: 'Connect an AI provider in Settings → AI Model first, so new articles can be made searchable.' }
    }
    logger.error('failed to add knowledge article', { module: 'actions/kb', orgId, error: err })
    return { error: 'Could not add this to the knowledge base. Try again.' }
  }
}
