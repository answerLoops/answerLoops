import { desc, eq, or, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { orgs, productFeedback, productUpdates } from '../schema'
import {
  isReplyTag,
  type BoardFeedback,
  type BoardSnapshot,
  type BoardUpdate,
  type FeedbackStatus,
  type ReplyTag,
} from '@/lib/product-feedback/validation'

/**
 * Everything the widget renders, scoped to one viewer. Approved feedback is
 * visible to all; a submitter additionally sees their own pending/rejected
 * rows. Author identity is resolved here so ids and emails never reach a
 * client.
 */
export async function getBoardSnapshot(input: { userId: number }): Promise<BoardSnapshot> {
  const db = getDb()
  const visible = or(eq(productFeedback.status, 'approved'), eq(productFeedback.userId, input.userId))

  const rows = await db
    .select({
      id: productFeedback.id,
      userId: productFeedback.userId,
      authorLabel: productFeedback.authorLabel,
      body: productFeedback.body,
      anonymous: productFeedback.anonymous,
      status: productFeedback.status,
      approvedAt: productFeedback.approvedAt,
      createdAt: productFeedback.createdAt,
      replyBody: productFeedback.replyBody,
      replyTag: productFeedback.replyTag,
      repliedAt: productFeedback.repliedAt,
      orgName: orgs.name,
    })
    .from(productFeedback)
    .leftJoin(orgs, eq(orgs.id, productFeedback.orgId))
    .where(visible)
    .orderBy(desc(productFeedback.createdAt))
    .limit(200)

  const feedback: BoardFeedback[] = rows.map((r) => ({
    id: r.id,
    authorLabel:
      r.authorLabel ?? (r.anonymous === 1 || !r.orgName ? 'Anonymous feedback' : `${r.orgName} user feedback`),
    body: r.body,
    status: r.status as FeedbackStatus,
    createdAt: r.createdAt,
    approvedAt: r.approvedAt,
    mine: r.userId !== null && r.userId === input.userId,
    reply:
      r.replyBody && r.repliedAt
        ? { body: r.replyBody, tag: isReplyTag(r.replyTag) ? (r.replyTag as ReplyTag) : null, repliedAt: r.repliedAt }
        : null,
  }))

  const [counts] = await db
    .select({ approved: sql<number>`COUNT(*) FILTER (WHERE ${productFeedback.status} = 'approved')::int` })
    .from(productFeedback)

  const updateRows = await db
    .select({
      id: productUpdates.id,
      title: productUpdates.title,
      body: productUpdates.body,
      publishedAt: productUpdates.publishedAt,
    })
    .from(productUpdates)
    .orderBy(desc(productUpdates.publishedAt), desc(productUpdates.id))
    .limit(50)

  return {
    approvedCount: counts?.approved ?? 0,
    feedback,
    updates: updateRows satisfies BoardUpdate[],
  }
}

export async function createProductFeedback(input: {
  orgId: number
  userId: number
  body: string
  anonymous: boolean
}): Promise<number> {
  const [row] = await getDb()
    .insert(productFeedback)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      body: input.body,
      anonymous: input.anonymous ? 1 : 0,
    })
    .returning({ id: productFeedback.id })
  return row.id
}

/**
 * Puts one real, attributed quote on an otherwise empty board so the first
 * visitor does not open an empty panel. Run at boot, and only where the board
 * is enabled — a deployment that never shows the board gets no rows. Seeds only
 * when the table has no rows at all, so a deleted entry is never resurrected
 * once real feedback exists.
 */
export async function seedProductFeedbackIfEmpty(): Promise<void> {
  const db = getDb()
  const [row] = await db.select({ n: sql<number>`COUNT(*)::int` }).from(productFeedback)
  if ((row?.n ?? 0) > 0) return
  const at = '2026-10-07T16:00:00.000Z'
  await db.insert(productFeedback).values({
    authorLabel: 'Sam K · DevRel',
    body: 'I really like the fact that I can connect Discord and GitHub with one click and have visibility into my community within minutes.',
    status: 'approved',
    approvedAt: at,
    replyBody: 'Thank you, Sam! Quick setup is something we care about a lot, so this is great to hear.',
    replyTag: 'great_feedback',
    repliedAt: at,
  })
}
