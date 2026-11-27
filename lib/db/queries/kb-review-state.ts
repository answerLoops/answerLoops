import { and, eq } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticles } from '../schema'
import { recordArticleEvent } from './kb-events'
import { contentHash } from '@/lib/kb/revision'
import { REVIEW_NOTE_MAX } from '@/lib/kb/review-state'
import type { ArticleReviewState, KBArticleEventType } from '@/types'

/**
 * Changes to an article's review state (lib/kb/review-state.ts). Each one locks
 * the article row, checks the state it is moving from, writes the new state and
 * appends its history event in one transaction, so the state and its history
 * never disagree and two people acting at once cannot both succeed.
 *
 * Every function is scoped to the workspace: another workspace's article reads
 * as not found. Permissions are checked by the caller (lib/actions/kb.ts).
 */

export type ReviewStateChangeResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'wrong_state' | 'invalid_replacement' }

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/** The article row this change acts on, locked until the transaction ends. */
async function lockArticle(tx: Tx, articleId: number, orgId: number) {
  const [row] = await tx
    .select({
      id: kbArticles.id,
      question: kbArticles.question,
      answer: kbArticles.answer,
      reviewState: kbArticles.reviewState,
    })
    .from(kbArticles)
    .where(and(eq(kbArticles.id, articleId), eq(kbArticles.orgId, orgId)))
    .for('update')
    .limit(1)
  return row ?? null
}

/**
 * Locks the article, checks it is in one of `from`, applies `set`, and records
 * `event` as a hand action by `userId`.
 */
async function transition(
  input: {
    articleId: number
    userId: number
    orgId: number
    from: readonly ArticleReviewState[]
    event: KBArticleEventType
  },
  set: (tx: Tx) => Promise<Partial<typeof kbArticles.$inferInsert> | 'invalid_replacement'>
): Promise<ReviewStateChangeResult> {
  return getDb().transaction(async (tx) => {
    const article = await lockArticle(tx, input.articleId, input.orgId)
    if (!article) return { ok: false, reason: 'not_found' }
    if (!input.from.includes(article.reviewState as ArticleReviewState)) return { ok: false, reason: 'wrong_state' }

    const values = await set(tx)
    if (values === 'invalid_replacement') return { ok: false, reason: 'invalid_replacement' }

    await tx
      .update(kbArticles)
      .set({ ...values, reviewStateAt: new Date().toISOString(), reviewStateBy: input.userId })
      .where(and(eq(kbArticles.id, input.articleId), eq(kbArticles.orgId, input.orgId)))
    await recordArticleEvent(tx, {
      orgId: input.orgId,
      articleId: input.articleId,
      type: input.event,
      actorUserId: input.userId,
      origin: 'manual',
      contentHash: contentHash(article.question, article.answer),
    })
    return { ok: true }
  })
}

/** Asks the team to take another look. The article keeps answering customers. */
export function flagArticleForReview(
  input: { articleId: number; userId: number; note?: string | null },
  orgId: number
): Promise<ReviewStateChangeResult> {
  const note = input.note?.trim().slice(0, REVIEW_NOTE_MAX) || null
  return transition(
    { articleId: input.articleId, userId: input.userId, orgId, from: ['current'], event: 'flagged_for_review' },
    async () => ({ reviewState: 'needs_review', reviewNote: note })
  )
}

/** Removes the needs-review mark. Nothing changes for customers. */
export function clearReviewFlag(
  input: { articleId: number; userId: number },
  orgId: number
): Promise<ReviewStateChangeResult> {
  return transition(
    { articleId: input.articleId, userId: input.userId, orgId, from: ['needs_review'], event: 'review_flag_cleared' },
    async () => ({ reviewState: 'current', reviewNote: null })
  )
}

export type Replacement = { articleId: number } | { url: string }

/**
 * Replaces an article with another article in the same workspace or a
 * documentation link. From then on it is never used for answers.
 *
 * A replacement article must be a different, published article in this
 * workspace that is not itself superseded; it is locked for the rest of the
 * transaction so it cannot be superseded or unpublished at the same moment.
 * The link is expected to be normalized already (parseReplacementUrl).
 */
export function supersedeArticle(
  input: { articleId: number; userId: number; replacement: Replacement },
  orgId: number
): Promise<ReviewStateChangeResult> {
  const { replacement } = input
  return transition(
    { articleId: input.articleId, userId: input.userId, orgId, from: ['current', 'needs_review'], event: 'superseded' },
    async (tx) => {
      if ('url' in replacement) {
        return {
          reviewState: 'superseded',
          reviewNote: null,
          supersededByArticleId: null,
          supersededByUrl: replacement.url,
        }
      }
      if (replacement.articleId === input.articleId) return 'invalid_replacement'
      const [target] = await tx
        .select({ published: kbArticles.published, reviewState: kbArticles.reviewState })
        .from(kbArticles)
        .where(and(eq(kbArticles.id, replacement.articleId), eq(kbArticles.orgId, orgId)))
        .for('share')
        .limit(1)
      if (!target || target.published !== 1 || target.reviewState === 'superseded') return 'invalid_replacement'
      return {
        reviewState: 'superseded',
        reviewNote: null,
        supersededByArticleId: replacement.articleId,
        supersededByUrl: null,
      }
    }
  )
}

/** Brings a superseded article back. It is used for answers again. */
export function restoreArticle(
  input: { articleId: number; userId: number },
  orgId: number
): Promise<ReviewStateChangeResult> {
  return transition(
    { articleId: input.articleId, userId: input.userId, orgId, from: ['superseded'], event: 'restored' },
    async () => ({ reviewState: 'current', reviewNote: null, supersededByArticleId: null, supersededByUrl: null })
  )
}
