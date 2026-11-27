'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { requireOrgAccess } from '@/lib/auth/org'
import { logger } from '@/lib/logger'
import { getTicketById } from '@/lib/db/queries/tickets'
import { countArticles, createArticle, getArticleBySourceTicket, verifyArticle } from '@/lib/db/queries/kb'
import {
  clearReviewFlag,
  flagArticleForReview,
  restoreArticle,
  supersedeArticle,
  type Replacement,
  type ReviewStateChangeResult,
} from '@/lib/db/queries/kb-review-state'
import { ArticleCapReachedError } from '@/lib/db/queries/kb-article-cap'
import { DuplicateArticleError } from '@/lib/db/queries/kb-duplicates'
import { embedTextWithModel } from '@/lib/ai/embed'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { aiUnavailableMessage } from '@/lib/ai/errors'
import { MAX_ARTICLES_PER_ORG } from '@/lib/kb/limits'
import { VERIFICATION_NOTE_MAX } from '@/lib/kb/verification'
import { REVIEW_NOTE_MAX, parseReplacementUrl } from '@/lib/kb/review-state'
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
    await createArticle({ question, answer, embedding, model, sourceTicketId: ticket.id, createdBy: access.userId }, orgId, MAX_ARTICLES_PER_ORG)
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
    const article = await createArticle({ question, answer, embedding, model, createdBy: access.userId, ...(sourceTicketId !== undefined ? { sourceTicketId } : {}) }, orgId, MAX_ARTICLES_PER_ORG, true)
    refresh()
    return { ok: true, articleId: article.id }
  } catch (err) {
    if (err instanceof ArticleCapReachedError) return { error: `Your knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before adding more.` }
    if (err instanceof DuplicateArticleError) return { error: 'This exact question and answer is already in the knowledge base.' }
    if (err instanceof NoAIProviderConfiguredError) {
      return { error: aiUnavailableMessage(err, 'Connect an AI provider in Settings → AI Model first, so new articles can be made searchable.') }
    }
    logger.error('failed to add knowledge article', { module: 'actions/kb', orgId, error: err })
    return { error: 'Could not add this to the knowledge base. Try again.' }
  }
}

// Verifying costs one small write, so the cap is loose: it only stops a script
// or a stuck button from flooding the history, not a person working down a list.
const VERIFY_MAX = 120
const VERIFY_WINDOW_MS = 10 * 60_000

const VerifyArticleSchema = z.object({
  articleId: z.coerce.number().int().positive(),
  note: z
    .string()
    .trim()
    .max(VERIFICATION_NOTE_MAX, `Keep the note under ${VERIFICATION_NOTE_MAX} characters`),
})

export type VerifyArticleState = { ok: true } | { error: string } | null

/**
 * Marks an article as checked: the signed-in person confirms its answer is
 * still correct. Limited to owners and admins, like writing an article. What is
 * recorded is the article's text at the moment of the check, so any later edit
 * makes it read as changed since last verified. The article must belong to the
 * session's workspace; the id in the form is never trusted on its own.
 */
export async function verifyArticleAction(
  _prevState: unknown,
  formData: FormData
): Promise<VerifyArticleState> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const parsed = VerifyArticleSchema.safeParse({
    articleId: formData.get('articleId'),
    note: formData.get('note') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const limit = await rateLimitShared(`kb-verify:${orgId}`, VERIFY_MAX, VERIFY_WINDOW_MS)
  if (!limit.ok) return { error: 'You are verifying too quickly. Try again in a few minutes.' }

  try {
    const recorded = await verifyArticle(
      { articleId: parsed.data.articleId, userId: access.userId, note: parsed.data.note },
      orgId
    )
    if (!recorded) return { error: 'Article not found' }
  } catch (err) {
    logger.error('failed to verify knowledge article', { module: 'actions/kb', orgId, error: err })
    return { error: 'Could not mark this as verified. Try again.' }
  }

  refresh()
  return { ok: true }
}

// Review-state changes share one budget per workspace. Generous for a person
// working down a list; it stops a script or a stuck button from flooding the
// article history.
const REVIEW_STATE_MAX = 120
const REVIEW_STATE_WINDOW_MS = 10 * 60_000

const ArticleIdSchema = z.object({ articleId: z.coerce.number().int().positive() })

const FlagArticleSchema = ArticleIdSchema.extend({
  note: z.string().trim().max(REVIEW_NOTE_MAX, `Keep the reason under ${REVIEW_NOTE_MAX} characters`),
})

const SupersedeSchema = ArticleIdSchema.extend({
  replacementKind: z.enum(['article', 'url']),
  replacementArticleId: z.string().optional(),
  replacementUrl: z.string().optional(),
})

export type ReviewStateActionState = { ok: true } | { error: string } | null

const STATE_ERRORS: Record<Exclude<ReviewStateChangeResult, { ok: true }>['reason'], string> = {
  not_found: 'Article not found',
  wrong_state: 'This article changed in the meantime. Reload the page and try again.',
  invalid_replacement: 'Choose a different published article that has not been replaced itself.',
}

/**
 * Shared by the four review-state actions: checks the role, parses the form,
 * applies the workspace's rate limit, runs the change and refreshes the page.
 * The article must belong to the session's workspace; the id in the form is
 * never trusted on its own.
 */
async function changeReviewState<T>(
  formData: FormData,
  roles: readonly ('owner' | 'admin' | 'member')[] | undefined,
  parse: (formData: FormData) => { ok: true; value: T } | { ok: false; error: string },
  run: (value: T, ctx: { orgId: number; userId: number }) => Promise<ReviewStateChangeResult>,
  failure: string
): Promise<ReviewStateActionState> {
  const access = await requireOrgAccess(roles)
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const parsed = parse(formData)
  if (!parsed.ok) return { error: parsed.error }

  const limit = await rateLimitShared(`kb-review-state:${orgId}`, REVIEW_STATE_MAX, REVIEW_STATE_WINDOW_MS)
  if (!limit.ok) return { error: 'You are changing articles too quickly. Try again in a few minutes.' }

  try {
    const result = await run(parsed.value, { orgId, userId: access.userId })
    if (!result.ok) return { error: STATE_ERRORS[result.reason] }
  } catch (err) {
    logger.error('failed to change knowledge article review state', { module: 'actions/kb', orgId, error: err })
    return { error: failure }
  }

  refresh()
  return { ok: true }
}

function parseArticleId(formData: FormData) {
  const parsed = ArticleIdSchema.safeParse({ articleId: formData.get('articleId') })
  return parsed.success
    ? ({ ok: true, value: parsed.data } as const)
    : ({ ok: false, error: 'Invalid input' } as const)
}

/**
 * Flags an article for the team to look at again, with an optional reason.
 * The article keeps answering customers, so any member of the workspace may
 * do this.
 */
export async function flagArticleForReviewAction(
  _prevState: unknown,
  formData: FormData
): Promise<ReviewStateActionState> {
  return changeReviewState(
    formData,
    undefined,
    (fd) => {
      const parsed = FlagArticleSchema.safeParse({ articleId: fd.get('articleId'), note: fd.get('note') ?? '' })
      return parsed.success
        ? { ok: true, value: parsed.data }
        : { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    },
    (v, ctx) => flagArticleForReview({ articleId: v.articleId, userId: ctx.userId, note: v.note }, ctx.orgId),
    'Could not flag this article. Try again.'
  )
}

/** Removes the needs-review mark. Nothing changes for customers, so any member may do this. */
export async function clearReviewFlagAction(
  _prevState: unknown,
  formData: FormData
): Promise<ReviewStateActionState> {
  return changeReviewState(
    formData,
    undefined,
    parseArticleId,
    (v, ctx) => clearReviewFlag({ articleId: v.articleId, userId: ctx.userId }, ctx.orgId),
    'Could not clear the flag. Try again.'
  )
}

/**
 * Replaces an article with another article or a documentation link. It stops
 * being used for answers, so this is limited to owners and admins.
 */
export async function supersedeArticleAction(
  _prevState: unknown,
  formData: FormData
): Promise<ReviewStateActionState> {
  return changeReviewState(
    formData,
    ['owner', 'admin'],
    (fd) => {
      const parsed = SupersedeSchema.safeParse({
        articleId: fd.get('articleId'),
        replacementKind: fd.get('replacementKind'),
        replacementArticleId: fd.get('replacementArticleId') ?? undefined,
        replacementUrl: fd.get('replacementUrl') ?? undefined,
      })
      if (!parsed.success) return { ok: false, error: 'Choose what replaces this article.' }
      const { articleId, replacementKind } = parsed.data
      let replacement: Replacement
      if (replacementKind === 'url') {
        const url = parseReplacementUrl(parsed.data.replacementUrl ?? '')
        if (!url) return { ok: false, error: 'Enter a full link that starts with http:// or https://' }
        replacement = { url }
      } else {
        const id = Number(parsed.data.replacementArticleId)
        if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Choose the article that replaces this one.' }
        replacement = { articleId: id }
      }
      return { ok: true, value: { articleId, replacement } }
    },
    (v, ctx) => supersedeArticle({ articleId: v.articleId, userId: ctx.userId, replacement: v.replacement }, ctx.orgId),
    'Could not mark this article as superseded. Try again.'
  )
}

/** Brings a superseded article back into answers. Limited to owners and admins. */
export async function restoreArticleAction(
  _prevState: unknown,
  formData: FormData
): Promise<ReviewStateActionState> {
  return changeReviewState(
    formData,
    ['owner', 'admin'],
    parseArticleId,
    (v, ctx) => restoreArticle({ articleId: v.articleId, userId: ctx.userId }, ctx.orgId),
    'Could not restore this article. Try again.'
  )
}
