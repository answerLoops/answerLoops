import { and, desc, eq, cosineDistance, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticles, kbReviewItems } from '../schema'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type ReviewSource = 'ticket' | 'widget'

export interface KBReviewItem {
  id: number
  source: ReviewSource
  ticket_id: number | null
  question: string
  answer: string
  confidence: number | null
  occurrences: number
  status: ReviewStatus
  article_id: number | null
  reviewed_at: string | null
  created_at: string
}

export interface ReviewCounts {
  pending: number
  approved: number
  rejected: number
}

// Two unseen questions whose embeddings are at least this similar are the same
// gap, so the second one raises the first's `occurrences` instead of adding a
// row. Matches DUPLICATE_THRESHOLD in lib/ai/related.ts (ticket-to-ticket).
export const REVIEW_DUPLICATE_SIMILARITY = 0.85

// Hard ceiling on unreviewed items per org. Public surfaces (the widget) feed
// this queue, so it must not be able to grow without bound.
export const MAX_PENDING_REVIEW_ITEMS = 500

function toItem(row: typeof kbReviewItems.$inferSelect): KBReviewItem {
  return {
    id: row.id,
    source: row.source as ReviewSource,
    ticket_id: row.ticketId ?? null,
    question: row.question,
    answer: row.answer,
    confidence: row.confidence ?? null,
    occurrences: row.occurrences,
    status: row.status as ReviewStatus,
    article_id: row.articleId ?? null,
    reviewed_at: row.reviewedAt ?? null,
    created_at: row.createdAt,
  }
}

export async function countReviewItems(orgId: number): Promise<ReviewCounts> {
  const rows = await getDb()
    .select({ status: kbReviewItems.status, n: sql<number>`COUNT(*)::int` })
    .from(kbReviewItems)
    .where(eq(kbReviewItems.orgId, orgId))
    .groupBy(kbReviewItems.status)
  const counts: ReviewCounts = { pending: 0, approved: 0, rejected: 0 }
  for (const r of rows) {
    if (r.status === 'pending' || r.status === 'approved' || r.status === 'rejected') counts[r.status] = r.n
  }
  return counts
}

export async function listReviewItems(orgId: number, status: ReviewStatus, limit = 100): Promise<KBReviewItem[]> {
  const rows = await getDb()
    .select()
    .from(kbReviewItems)
    .where(and(eq(kbReviewItems.orgId, orgId), eq(kbReviewItems.status, status)))
    // Most-asked gaps first; ties broken newest first.
    .orderBy(desc(kbReviewItems.occurrences), desc(kbReviewItems.createdAt))
    .limit(limit)
  return rows.map(toItem)
}

export async function getReviewItem(id: number, orgId: number): Promise<KBReviewItem | null> {
  const [row] = await getDb()
    .select()
    .from(kbReviewItems)
    .where(and(eq(kbReviewItems.id, id), eq(kbReviewItems.orgId, orgId)))
    .limit(1)
  return row ? toItem(row) : null
}

/**
 * Records an unseen question. Folds into an existing pending or rejected item
 * when the question is a near-duplicate (a rejected gap stays rejected — the
 * count just keeps rising so it is visible if people keep asking). Returns
 * what happened ('exists' when this ticket was already captured), or 'full' when the org's pending queue is at its ceiling.
 */
export async function recordReviewItem(
  input: {
    source: ReviewSource
    ticketId?: number | null
    question: string
    answer: string
    embedding: number[]
    confidence?: number | null
  },
  orgId: number
): Promise<'created' | 'merged' | 'exists' | 'full'> {
  const db = getDb()

  // A ticket's draft run can be retried by the pipeline; one ticket is one
  // observation of a gap, so a second run must not raise the count.
  if (input.ticketId != null) {
    const [seen] = await db
      .select({ id: kbReviewItems.id })
      .from(kbReviewItems)
      .where(and(eq(kbReviewItems.orgId, orgId), eq(kbReviewItems.ticketId, input.ticketId)))
      .limit(1)
    if (seen) return 'exists'
  }

  const distance = cosineDistance(kbReviewItems.embeddingVec, input.embedding)
  const [duplicate] = await db
    .select({ id: kbReviewItems.id })
    .from(kbReviewItems)
    .where(
      and(
        eq(kbReviewItems.orgId, orgId),
        inArray(kbReviewItems.status, ['pending', 'rejected']),
        isNotNull(kbReviewItems.embeddingVec),
        sql`${distance} <= ${1 - REVIEW_DUPLICATE_SIMILARITY}`
      )
    )
    .orderBy(distance)
    .limit(1)

  if (duplicate) {
    await db
      .update(kbReviewItems)
      .set({ occurrences: sql`${kbReviewItems.occurrences} + 1`, updatedAt: new Date().toISOString() })
      .where(and(eq(kbReviewItems.id, duplicate.id), eq(kbReviewItems.orgId, orgId)))
    return 'merged'
  }

  const [{ n: pending }] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(kbReviewItems)
    .where(and(eq(kbReviewItems.orgId, orgId), eq(kbReviewItems.status, 'pending')))
  if (pending >= MAX_PENDING_REVIEW_ITEMS) return 'full'

  await db.insert(kbReviewItems).values({
    orgId,
    source: input.source,
    ticketId: input.ticketId ?? null,
    question: input.question,
    answer: input.answer,
    embeddingVec: input.embedding,
    confidence: input.confidence ?? null,
  })
  return 'created'
}

export type ReviewResolution = { ok: true } | { ok: false; reason: 'not_pending' | 'not_found' }

/**
 * Claims a pending item and publishes its (possibly edited) text as a KB
 * article in one transaction, so two reviewers approving the same item can
 * never produce two articles. The claim is the conditional UPDATE: only one
 * caller sees the row still pending.
 */
export async function approveReviewItem(
  input: {
    id: number
    question: string
    answer: string
    embedding: number[]
    model: string
    reviewedBy: number
  },
  orgId: number
): Promise<ReviewResolution & { articleId?: number }> {
  return getDb().transaction(async (tx) => {
    const now = new Date().toISOString()
    const [claimed] = await tx
      .update(kbReviewItems)
      .set({
        status: 'approved',
        question: input.question,
        answer: input.answer,
        reviewedBy: input.reviewedBy,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(and(eq(kbReviewItems.id, input.id), eq(kbReviewItems.orgId, orgId), eq(kbReviewItems.status, 'pending')))
      .returning({ id: kbReviewItems.id })

    if (!claimed) {
      const [exists] = await tx
        .select({ id: kbReviewItems.id })
        .from(kbReviewItems)
        .where(and(eq(kbReviewItems.id, input.id), eq(kbReviewItems.orgId, orgId)))
        .limit(1)
      return { ok: false as const, reason: exists ? ('not_pending' as const) : ('not_found' as const) }
    }

    const [article] = await tx
      .insert(kbArticles)
      .values({
        orgId,
        question: input.question,
        answer: input.answer,
        embedding: JSON.stringify(input.embedding),
        embeddingVec: input.embedding,
        model: input.model,
      })
      .returning({ id: kbArticles.id })

    await tx.update(kbReviewItems).set({ articleId: article.id }).where(eq(kbReviewItems.id, input.id))
    return { ok: true as const, articleId: article.id }
  })
}

async function transition(
  id: number,
  orgId: number,
  from: ReviewStatus,
  to: ReviewStatus,
  reviewedBy: number
): Promise<ReviewResolution> {
  const db = getDb()
  const now = new Date().toISOString()
  const [row] = await db
    .update(kbReviewItems)
    .set({
      status: to,
      reviewedBy: to === 'pending' ? null : reviewedBy,
      reviewedAt: to === 'pending' ? null : now,
      updatedAt: now,
    })
    .where(and(eq(kbReviewItems.id, id), eq(kbReviewItems.orgId, orgId), eq(kbReviewItems.status, from)))
    .returning({ id: kbReviewItems.id })
  if (row) return { ok: true }

  const [exists] = await db
    .select({ id: kbReviewItems.id })
    .from(kbReviewItems)
    .where(and(eq(kbReviewItems.id, id), eq(kbReviewItems.orgId, orgId)))
    .limit(1)
  return { ok: false, reason: exists ? 'not_pending' : 'not_found' }
}

export function rejectReviewItem(id: number, orgId: number, reviewedBy: number): Promise<ReviewResolution> {
  return transition(id, orgId, 'pending', 'rejected', reviewedBy)
}

export function reopenReviewItem(id: number, orgId: number, reviewedBy: number): Promise<ReviewResolution> {
  return transition(id, orgId, 'rejected', 'pending', reviewedBy)
}
