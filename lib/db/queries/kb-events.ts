import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticleEvents, kbArticles, kbReviewItems, tickets, users } from '../schema'
import type { KBArticleEvent, KBArticleEventOrigin, KBArticleEventType, KBArticleHistoryEntry } from '@/types'

// Either a database or an open transaction; both can insert and update.
type Executor = Pick<ReturnType<typeof getDb>, 'insert' | 'update'>

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
  await insertEvent(tx, input)
  if (input.type === 'edited' && input.articleId != null && input.contentHash) {
    await flagVerifiedArticleAfterEdit(tx, {
      orgId: input.orgId,
      articleId: input.articleId,
      contentHash: input.contentHash,
      actorUserId: input.actorUserId ?? null,
      origin: input.origin,
    })
  }
}

async function insertEvent(tx: Pick<Executor, 'insert'>, input: ArticleEventInput): Promise<void> {
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
 * Marks a verified article as needing review when an edit changes its text away
 * from what was verified, and records an 'auto_flagged_for_review' event with
 * the same actor and origin as the edit. Every path that edits an article
 * records an 'edited' event through recordArticleEvent, so this runs for hand
 * edits, ticket refreshes, imports and syncs alike, inside the edit's own
 * transaction.
 *
 * Only an article in the 'current' state is flagged: one already flagged keeps
 * its original reason, and a superseded one stays superseded. An article that
 * was never verified, or whose new text matches what was verified, is left
 * alone. One conditional UPDATE decides all of that, so two concurrent edits
 * cannot flag twice. The article keeps answering customers either way.
 */
async function flagVerifiedArticleAfterEdit(
  tx: Executor,
  input: {
    orgId: number
    articleId: number
    contentHash: string
    actorUserId: number | null
    origin: KBArticleEventOrigin
  }
): Promise<void> {
  const flagged = await tx
    .update(kbArticles)
    .set({
      reviewState: 'needs_review',
      reviewStateAt: new Date().toISOString(),
      reviewStateBy: input.actorUserId,
      reviewNote: null,
    })
    .where(
      and(
        eq(kbArticles.id, input.articleId),
        eq(kbArticles.orgId, input.orgId),
        eq(kbArticles.reviewState, 'current'),
        isNotNull(kbArticles.verifiedAt),
        sql`${kbArticles.verifiedContentHash} IS DISTINCT FROM ${input.contentHash}`
      )
    )
    .returning({ id: kbArticles.id })
  if (flagged.length === 0) return
  await insertEvent(tx, {
    orgId: input.orgId,
    articleId: input.articleId,
    type: 'auto_flagged_for_review',
    actorUserId: input.actorUserId,
    origin: input.origin,
    contentHash: input.contentHash,
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

/**
 * An article's history as the dashboard shows it: the same events as
 * getArticleEvents, newest first, with the actor's name and the number of the
 * ticket an event came from. Returns null when the article does not exist in
 * this workspace, so a caller can tell "no such article" from "no history".
 *
 * Everything is scoped to the workspace, including the joins: another
 * workspace's article, user or ticket never appears here.
 */
export async function getArticleHistory(articleId: number, orgId: number): Promise<KBArticleHistoryEntry[] | null> {
  const db = getDb()
  const [article] = await db
    .select({ id: kbArticles.id })
    .from(kbArticles)
    .where(and(eq(kbArticles.id, articleId), eq(kbArticles.orgId, orgId)))
    .limit(1)
  if (!article) return null

  const rows = await db
    .select({
      event: kbArticleEvents,
      actorName: users.name,
      actorEmail: users.email,
      ticketNumber: tickets.orgTicketNumber,
    })
    .from(kbArticleEvents)
    .leftJoin(users, eq(users.id, kbArticleEvents.actorUserId))
    .leftJoin(tickets, and(eq(tickets.id, kbArticleEvents.sourceTicketId), eq(tickets.orgId, orgId)))
    .where(
      and(
        eq(kbArticleEvents.orgId, orgId),
        or(
          eq(kbArticleEvents.articleId, articleId),
          inArray(
            kbArticleEvents.reviewItemId,
            db
              .select({ id: kbReviewItems.id })
              .from(kbReviewItems)
              .where(and(eq(kbReviewItems.articleId, articleId), eq(kbReviewItems.orgId, orgId)))
          )
        )
      )
    )
    .orderBy(desc(kbArticleEvents.createdAt), desc(kbArticleEvents.id))

  return rows.map(({ event: r, actorName, actorEmail, ticketNumber }) => ({
    id: r.id,
    article_id: r.articleId ?? null,
    type: r.type as KBArticleEventType,
    actor_user_id: r.actorUserId ?? null,
    origin: r.origin as KBArticleEventOrigin,
    source_ticket_id: r.sourceTicketId ?? null,
    review_item_id: r.reviewItemId ?? null,
    content_hash: r.contentHash ?? null,
    created_at: r.createdAt,
    actor_name: r.actorUserId == null ? null : (actorName ?? actorEmail ?? null),
    source_ticket_number: ticketNumber ?? null,
  }))
}
