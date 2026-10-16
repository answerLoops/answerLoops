import { and, desc, eq, cosineDistance, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
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

// Most times one item's occurrence count can rise in a single UTC day.
export const MAX_DAILY_OCCURRENCE_INCREMENTS = 20

// Review text of rejected items, and of approved items older than this, is
// cleared (the approved text lives on in the published article).
export const REVIEW_TEXT_RETENTION_DAYS = 90

// Advisory-lock namespace for queue inserts, per org.
const REVIEW_INSERT_LOCK_KEY = 5107

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
        // Only rows on the workspace's pinned embedding model, so two models
        // never meet in one similarity score (lib/ai/embedding-pin.ts).
        sql`${kbReviewItems.model} = (SELECT embedding_model_in_use FROM orgs WHERE id = ${orgId})`,
        sql`${distance} <= ${1 - REVIEW_DUPLICATE_SIMILARITY}`
      )
    )
    .orderBy(distance)
    .limit(1)

  if (duplicate) {
    // Counted at most MAX_DAILY_OCCURRENCE_INCREMENTS times per UTC day; the
    // count then holds until the next day.
    await db.execute(sql`
      UPDATE kb_review_items
      SET occurrences = occurrences + 1,
          merge_day_count = CASE WHEN merge_day = (now() AT TIME ZONE 'UTC')::date THEN merge_day_count + 1 ELSE 1 END,
          merge_day = (now() AT TIME ZONE 'UTC')::date,
          updated_at = ${new Date().toISOString()}
      WHERE id = ${duplicate.id}
        AND org_id = ${orgId}
        AND (merge_day IS DISTINCT FROM (now() AT TIME ZONE 'UTC')::date
             OR merge_day_count < ${MAX_DAILY_OCCURRENCE_INCREMENTS})
    `)
    return 'merged'
  }

  // The queue-size check and the insert are one statement, run under a per-org
  // lock, so concurrent captures keep the queue within its limit.
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${REVIEW_INSERT_LOCK_KEY}, ${orgId})`)
    const rows = (await tx.execute(sql`
      INSERT INTO kb_review_items (org_id, source, ticket_id, question, answer, embedding_vec, model, confidence)
      SELECT ${orgId}, ${input.source}, ${input.ticketId ?? null}, ${input.question}, ${input.answer},
             ${JSON.stringify(input.embedding)}::vector,
             (SELECT embedding_model_in_use FROM orgs WHERE id = ${orgId}),
             ${input.confidence ?? null}
      WHERE (SELECT COUNT(*) FROM kb_review_items WHERE org_id = ${orgId} AND status = 'pending') < ${MAX_PENDING_REVIEW_ITEMS}
      RETURNING id
    `)) as unknown as { id: number }[]
    return rows.length > 0
  })
  return inserted ? 'created' : 'full'
}

/**
 * Clears the question and answer text of rejected items and of approved items
 * reviewed more than REVIEW_TEXT_RETENTION_DAYS ago, across every org. Rows,
 * counts and similarity vectors stay, so a rejected gap is still recognised
 * as a repeat. Idempotent. Returns how many rows were cleared. Call it on a
 * schedule (for example once a day from the bot process).
 */
export async function purgeExpiredReviewText(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REVIEW_TEXT_RETENTION_DAYS * 86_400_000).toISOString()
  const rows = await getDb()
    .update(kbReviewItems)
    .set({ question: '', answer: '' })
    .where(
      and(
        or(
          eq(kbReviewItems.status, 'rejected'),
          and(eq(kbReviewItems.status, 'approved'), lt(kbReviewItems.reviewedAt, cutoff))
        ),
        or(sql`${kbReviewItems.question} <> ''`, sql`${kbReviewItems.answer} <> ''`)
      )
    )
    .returning({ id: kbReviewItems.id })
  return rows.length
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
