import { and, desc, eq, or, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { orgs, productFeedback, productFeedbackVotes, productUpdates } from '../schema'
import {
  isReplyTag,
  type BoardFeedback,
  type BoardSnapshot,
  type BoardSort,
  type BoardUpdate,
  type FeedbackStatus,
  type ReplyTag,
  type VoteResult,
} from '@/lib/product-feedback/validation'

/**
 * Everything the widget renders, scoped to one viewer. Approved feedback is
 * visible to all; a submitter additionally sees their own pending/rejected
 * rows. Author identity is resolved here so ids and emails never reach a
 * client. The order is decided here, before the 200-row cap, so "votes"
 * ranks the whole board and not only the newest rows.
 */
export async function getBoardSnapshot(input: { userId: number; sort?: BoardSort }): Promise<BoardSnapshot> {
  const db = getDb()
  const visible = or(eq(productFeedback.status, 'approved'), eq(productFeedback.userId, input.userId))
  // Vote facts are computed per row from the votes table; nothing about other
  // voters leaves the database, only the count and the viewer's own
  // membership in it. The count is also the sort key for "votes".
  const voteCount = sql<number>`(SELECT COUNT(*)::int FROM ${productFeedbackVotes} WHERE ${productFeedbackVotes.feedbackId} = ${productFeedback.id})`
  const order =
    input.sort === 'votes'
      ? [desc(voteCount), desc(productFeedback.createdAt)]
      : [desc(productFeedback.createdAt)]

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
      voteCount,
      viewerVoted: sql<boolean>`EXISTS (SELECT 1 FROM ${productFeedbackVotes} WHERE ${productFeedbackVotes.feedbackId} = ${productFeedback.id} AND ${productFeedbackVotes.userId} = ${input.userId})`,
    })
    .from(productFeedback)
    .leftJoin(orgs, eq(orgs.id, productFeedback.orgId))
    .where(visible)
    .orderBy(...order)
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
    voteCount: Number(r.voteCount ?? 0),
    viewerVoted: r.viewerVoted === true,
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
 * Set the caller's up-vote on an entry to the state they asked for. Removing
 * is a plain delete, so repeating it is harmless. Adding inserts only where
 * the entry is approved and not the caller's own — that predicate IS the
 * rule; hiding the arrow in the UI is a courtesy — and an existing row counts
 * as success, so a retried or doubled request lands in the same place. The
 * UNIQUE (feedback_id, user_id) constraint is what keeps one vote per person
 * under concurrent adds; ON CONFLICT DO NOTHING turns the loser's insert into
 * a no-op instead of an error. No transaction: every statement here is
 * idempotent on its own.
 *
 * org_id on the vote is the voter's workspace, so hardPurgeOrg can find it.
 */
export async function setProductFeedbackVote(input: {
  feedbackId: number
  userId: number
  orgId: number
  voted: boolean
}): Promise<VoteResult> {
  // Cheap guard before any query: the action validates, this never trusts it.
  if (!Number.isInteger(input.feedbackId) || input.feedbackId < 1) return 'refused'
  const db = getDb()
  const own = and(
    eq(productFeedbackVotes.feedbackId, input.feedbackId),
    eq(productFeedbackVotes.userId, input.userId),
  )

  if (!input.voted) {
    await db.delete(productFeedbackVotes).where(own)
    return 'removed'
  }

  // INSERT ... SELECT so the eligibility check and the write are one
  // statement. IS DISTINCT FROM (not <>) because seeded example rows have a
  // NULL author and are votable.
  const inserted = (await db.execute(sql`
    INSERT INTO ${productFeedbackVotes} (feedback_id, user_id, org_id)
    SELECT ${productFeedback.id}, ${input.userId}, ${input.orgId}
    FROM ${productFeedback}
    WHERE ${productFeedback.id} = ${input.feedbackId}
      AND ${productFeedback.status} = 'approved'
      AND ${productFeedback.userId} IS DISTINCT FROM ${input.userId}
    ON CONFLICT DO NOTHING
    RETURNING id
  `)) as unknown as { id: number }[]
  if (inserted.length > 0) return 'added'

  // Nothing written: either the vote already existed (a doubled or retried
  // request — the state the caller asked for is already true) or the rule
  // refused it. Only the first is success.
  const [existing] = await db
    .select({ id: productFeedbackVotes.id })
    .from(productFeedbackVotes)
    .where(own)
    .limit(1)
  return existing ? 'added' : 'refused'
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
