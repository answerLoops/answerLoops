import { and, desc, eq, inArray, or } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticleEvents, kbReviewItems } from '../schema'
import type { KBArticleEvent, KBArticleEventOrigin, KBArticleEventType } from '@/types'

// Either a database or an open transaction; both can insert.
type Executor = Pick<ReturnType<typeof getDb>, 'insert'>

export interface ArticleEventInput {
  orgId: number
  articleId: number | null
  type: KBArticleEventType
  /** Null for automated events (imports and syncs). */
  actorUserId?: number | null
  origin: KBArticleEventOrigin
  sourceTicketId?: number | null
  reviewItemId?: number | null
  contentHash?: string | null
}

/**
 * Appends one event. Pass the open transaction of the change the event
 * describes, so the two commit or roll back together and a failed change never
 * leaves a history entry behind. Events are never updated or deleted here.
 */
export async function recordArticleEvent(tx: Executor, input: ArticleEventInput): Promise<void> {
  await tx.insert(kbArticleEvents).values({
    orgId: input.orgId,
    articleId: input.articleId,
    type: input.type,
    actorUserId: input.actorUserId ?? null,
    origin: input.origin,
    sourceTicketId: input.sourceTicketId ?? null,
    reviewItemId: input.reviewItemId ?? null,
    contentHash: input.contentHash ?? null,
  })
}

/**
 * The history of one article, newest first, scoped to the workspace. It
 * includes the review decisions on the review item that produced the article
 * (a rejection or reopening happens before the article exists, so those events
 * are linked through the review item rather than the article).
 */
export async function getArticleEvents(articleId: number, orgId: number): Promise<KBArticleEvent[]> {
  const rows = await getDb()
    .select()
    .from(kbArticleEvents)
    .where(
      and(
        eq(kbArticleEvents.orgId, orgId),
        or(
          eq(kbArticleEvents.articleId, articleId),
          inArray(
            kbArticleEvents.reviewItemId,
            getDb()
              .select({ id: kbReviewItems.id })
              .from(kbReviewItems)
              .where(and(eq(kbReviewItems.articleId, articleId), eq(kbReviewItems.orgId, orgId)))
          )
        )
      )
    )
    .orderBy(desc(kbArticleEvents.createdAt), desc(kbArticleEvents.id))
  return rows.map((r) => ({
    id: r.id,
    article_id: r.articleId ?? null,
    type: r.type as KBArticleEventType,
    actor_user_id: r.actorUserId ?? null,
    origin: r.origin as KBArticleEventOrigin,
    source_ticket_id: r.sourceTicketId ?? null,
    review_item_id: r.reviewItemId ?? null,
    content_hash: r.contentHash ?? null,
    created_at: r.createdAt,
  }))
}
