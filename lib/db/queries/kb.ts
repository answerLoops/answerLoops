import { eq, and, desc, sql, or, ilike, isNotNull, ne, cosineDistance } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb } from '../drizzle'
import { kbArticles, tickets, users } from '../schema'
import { assertWithinArticleCap } from './kb-article-cap'
import { recordArticleEvent } from './kb-events'
import { contentHash } from '@/lib/kb/revision'
import { dropExactDuplicates } from '@/lib/kb/duplicates'
import { DuplicateArticleError, findExactDuplicate } from './kb-duplicates'
import { toVerification, VERIFICATION_NOTE_MAX } from '@/lib/kb/verification'
import { relatedDocsChange } from '@/lib/kb/docs-change'
import type { ArticleReview, ArticleReviewState, KBArticle, KBSearchResult, PriorAnswer, WidgetKBContext } from '@/types'
import { KB_MATCH_THRESHOLD, KB_NEAR_MISS_FLOOR, chooseWidgetContext } from '@/lib/kb/widget-context'

// Defined with the widget's choice of articles (lib/kb/widget-context.ts);
// re-exported here for the callers that search through this module.
export { KB_MATCH_THRESHOLD, KB_NEAR_MISS_FLOOR }

// Candidates the HNSW index examines per query. The default (40) can return
// fewer rows than asked for once the org/published/model filters discard
// most of the nearest neighbours, so it is raised for the duration of the scan.
const HNSW_EF_SEARCH = 200

function toArticle(row: typeof kbArticles.$inferSelect): KBArticle {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    source_ticket_id: row.sourceTicketId ?? null,
    source_ticket_number: null,
    source_id: row.sourceId ?? null,
    source_page: row.sourcePage ?? null,
    published: row.published as 0 | 1,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export async function createArticle(
  input: {
    question: string
    answer: string
    embedding: number[]
    model: string
    sourceTicketId?: number
    // The signed-in user adding the article. Stored on a new row only; refreshing
    // an existing ticket article keeps whoever added it first. It is also the
    // actor on the history event this writes.
    createdBy?: number
  },
  orgId: number,
  // When given, a new row is added only while the workspace is under this many
  // articles (ArticleCapReachedError otherwise). Refreshing an article that
  // already exists for the ticket adds no row, so it is never refused.
  cap?: number,
  // When true, a new row is refused with DuplicateArticleError if the workspace
  // already holds the exact same question and answer. Refreshing an article for
  // the same ticket is unaffected.
  rejectExactDuplicate = false
): Promise<KBArticle> {
  // The article and its history event commit together, so a failed write never
  // leaves a history entry behind.
  return getDb().transaction(async (tx) => {
    if (input.sourceTicketId != null) {
      const [existing] = await tx
        .select({ id: kbArticles.id, question: kbArticles.question, answer: kbArticles.answer })
        .from(kbArticles)
        .where(and(eq(kbArticles.sourceTicketId, input.sourceTicketId), eq(kbArticles.orgId, orgId)))
        .limit(1)

      if (existing) {
        await tx
          .update(kbArticles)
          .set({
            question: input.question,
            answer: input.answer,
            embedding: JSON.stringify(input.embedding),
            embeddingVec: input.embedding,
            model: input.model,
            // A fresh vector supersedes anything the re-embed job staged from
            // the old text (lib/kb/embedding-migration.ts).
            embeddingNext: null,
            embeddingVecNext: null,
            modelNext: null,
            published: 1,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(kbArticles.id, existing.id))

        // Only a change to the words is an edit. Refreshing with identical text
        // re-embeds the article but adds nothing to its history.
        const hash = contentHash(input.question, input.answer)
        if (hash !== contentHash(existing.question, existing.answer)) {
          await recordArticleEvent(tx, {
            orgId,
            articleId: existing.id,
            type: 'edited',
            actorUserId: input.createdBy ?? null,
            origin: 'ticket_promotion',
            sourceTicketId: input.sourceTicketId,
            contentHash: hash,
          })
        }
        const [row] = await tx.select().from(kbArticles).where(eq(kbArticles.id, existing.id)).limit(1)
        return toArticle(row)
      }
    }

    if (cap !== undefined) await assertWithinArticleCap(tx, orgId, cap)
    if (rejectExactDuplicate) {
      const duplicateOf = await findExactDuplicate(tx, orgId, input.question, input.answer)
      if (duplicateOf !== null) throw new DuplicateArticleError(duplicateOf)
    }

    const [row] = await tx
      .insert(kbArticles)
      .values({
        orgId,
        question: input.question,
        answer: input.answer,
        embedding: JSON.stringify(input.embedding),
        embeddingVec: input.embedding,
        model: input.model,
        sourceTicketId: input.sourceTicketId ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning()

    // An article written from a ticket (promoted, or added from the Knowledge
    // Gaps page) is a promotion; one written from scratch is created by hand.
    const fromTicket = input.sourceTicketId != null
    await recordArticleEvent(tx, {
      orgId,
      articleId: row.id,
      type: fromTicket ? 'promoted' : 'created',
      actorUserId: input.createdBy ?? null,
      origin: fromTicket ? 'ticket_promotion' : 'manual',
      sourceTicketId: input.sourceTicketId ?? null,
      contentHash: contentHash(input.question, input.answer),
    })
    return toArticle(row)
  })
}

async function getArticle(id: number): Promise<KBArticle | null> {
  const [row] = await getDb()
    .select()
    .from(kbArticles)
    .where(eq(kbArticles.id, id))
    .limit(1)
  return row ? toArticle(row) : null
}

export async function countArticles(orgId: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(kbArticles)
    .where(eq(kbArticles.orgId, orgId))
  return row?.n ?? 0
}

export async function getArticleBySourceTicket(ticketId: number, orgId: number): Promise<KBArticle | null> {
  const [row] = await getDb()
    .select()
    .from(kbArticles)
    .where(and(eq(kbArticles.sourceTicketId, ticketId), eq(kbArticles.orgId, orgId)))
    .limit(1)
  return row ? toArticle(row) : null
}

// The person who set an article's review state, and the article that replaced
// it, joined under their own names so they do not collide with the verifier
// and the article itself.
const reviewer = alias(users, 'reviewer')
const replacementArticle = alias(kbArticles, 'replacement_article')

export async function listArticles(publishedOnly = true, orgId: number): Promise<KBArticle[]> {
  const conditions = publishedOnly
    ? and(eq(kbArticles.published, 1), eq(kbArticles.orgId, orgId))
    : eq(kbArticles.orgId, orgId)

  // Joined so the UI can link to the source ticket's user-facing number
  // (tickets.org_ticket_number) rather than the internal DB id.
  const rows = await getDb()
    .select({
      article: kbArticles,
      sourceTicketNumber: tickets.orgTicketNumber,
      verifierName: users.name,
      verifierEmail: users.email,
      reviewerName: reviewer.name,
      reviewerEmail: reviewer.email,
      replacementQuestion: replacementArticle.question,
    })
    .from(kbArticles)
    .leftJoin(tickets, eq(tickets.id, kbArticles.sourceTicketId))
    .leftJoin(users, eq(users.id, kbArticles.verifiedBy))
    .leftJoin(reviewer, eq(reviewer.id, kbArticles.reviewStateBy))
    .leftJoin(
      replacementArticle,
      and(eq(replacementArticle.id, kbArticles.supersededByArticleId), eq(replacementArticle.orgId, orgId))
    )
    .where(conditions)
    .orderBy(desc(kbArticles.updatedAt))
  return rows.map((r) => ({
    ...toArticle(r.article),
    source_ticket_number: r.sourceTicketNumber ?? null,
    verification: toVerification(r.article, r.verifierName ?? r.verifierEmail ?? null),
    related_docs_changed: relatedDocsChange(r.article),
    review: toReview(r.article, r.reviewerName ?? r.reviewerEmail ?? null, r.replacementQuestion ?? null),
  }))
}

/** The review facts the dashboard shows for one article. */
function toReview(
  row: typeof kbArticles.$inferSelect,
  reviewerName: string | null,
  replacementQuestion: string | null
): ArticleReview {
  const state = row.reviewState as ArticleReviewState
  let replacement: ArticleReview['replacement'] = null
  if (state === 'superseded') {
    if (row.supersededByUrl) replacement = { kind: 'url', url: row.supersededByUrl }
    else if (row.supersededByArticleId != null && replacementQuestion != null) {
      replacement = { kind: 'article', article_id: row.supersededByArticleId, question: replacementQuestion }
    }
  }
  return {
    state,
    at: row.reviewStateAt ?? null,
    by_name: row.reviewStateBy == null ? null : reviewerName,
    note: state === 'needs_review' ? (row.reviewNote ?? null) : null,
    replacement,
  }
}

/**
 * Records that a person checked an article and found its answer still correct.
 *
 * Stores who, when, an optional note, and the hash of the question and answer
 * as they are right now, then appends a 'verified' event, all in one
 * transaction. The row is locked while it is read, so a concurrent edit cannot
 * slip in between reading the text and hashing it: what is recorded is exactly
 * what the verifier saw. Scoped to the workspace; another workspace's article
 * reads as not found. Returns null in that case.
 */
export async function verifyArticle(
  input: { articleId: number; userId: number; note?: string | null },
  orgId: number
): Promise<{ verifiedAt: string; contentHash: string } | null> {
  const note = input.note?.trim().slice(0, VERIFICATION_NOTE_MAX) || null
  return getDb().transaction(async (tx) => {
    const [article] = await tx
      .select({ question: kbArticles.question, answer: kbArticles.answer })
      .from(kbArticles)
      .where(and(eq(kbArticles.id, input.articleId), eq(kbArticles.orgId, orgId)))
      .for('update')
      .limit(1)
    if (!article) return null

    const hash = contentHash(article.question, article.answer)
    const verifiedAt = new Date().toISOString()
    await tx
      .update(kbArticles)
      .set({ verifiedAt, verifiedBy: input.userId, verifiedContentHash: hash, verificationNote: note })
      .where(and(eq(kbArticles.id, input.articleId), eq(kbArticles.orgId, orgId)))
    // Checking the answer is what a needs-review flag asks for, so verifying
    // clears it, with its own history entry ahead of the verification.
    const cleared = await tx
      .update(kbArticles)
      .set({ reviewState: 'current', reviewStateAt: verifiedAt, reviewStateBy: input.userId, reviewNote: null })
      .where(
        and(eq(kbArticles.id, input.articleId), eq(kbArticles.orgId, orgId), eq(kbArticles.reviewState, 'needs_review'))
      )
      .returning({ id: kbArticles.id })
    if (cleared.length > 0) {
      await recordArticleEvent(tx, {
        orgId,
        articleId: input.articleId,
        type: 'review_flag_cleared',
        actorUserId: input.userId,
        origin: 'manual',
        contentHash: hash,
      })
    }
    await recordArticleEvent(tx, {
      orgId,
      articleId: input.articleId,
      type: 'verified',
      actorUserId: input.userId,
      origin: 'manual',
      contentHash: hash,
    })
    return { verifiedAt, contentHash: hash }
  })
}

// pgvector ANN search via the embedding_vec column (see schema.ts) instead of
// loading every published article and scoring in JS — that full-table scan
// was the single most-called AI-path bottleneck in the product (search, FAQ
// answers, chat all route through this). Rows with no embedding_vec (only
// possible for legacy rows written before this column existed — a new write
// with a mismatched dimension fails at insert instead, see schema.ts) are
// excluded rather than silently scored as a zero match.
// Iterative index scans (hnsw.iterative_scan) arrived in pgvector 0.8.0.
const ITERATIVE_SCAN_MIN_VERSION = [0, 8, 0] as const

export function isIterativeScanVersion(version: string): boolean {
  const parts = version.trim().split('.').map((p) => Number.parseInt(p, 10))
  if (parts.length === 0 || parts.some((n, i) => i < 3 && !Number.isFinite(n))) return false
  for (let i = 0; i < 3; i++) {
    const have = parts[i] ?? 0
    const need = ITERATIVE_SCAN_MIN_VERSION[i]
    if (have !== need) return have > need
  }
  return true
}

let iterativeScanSupport: Promise<boolean> | null = null

/**
 * Whether the connected pgvector build supports iterative scans. Looked up once
 * per process; a failed lookup counts as unsupported so search keeps working
 * with the index's default behaviour.
 */
function supportsIterativeScan(): Promise<boolean> {
  iterativeScanSupport ??= (async () => {
    try {
      const res = (await getDb().execute(
        sql`select extversion from pg_extension where extname = 'vector'`
      )) as unknown as { rows?: Array<{ extversion?: string }> } | Array<{ extversion?: string }>
      const rows = Array.isArray(res) ? res : (res.rows ?? [])
      const version = rows[0]?.extversion
      return typeof version === 'string' && isIterativeScanVersion(version)
    } catch {
      return false
    }
  })()
  return iterativeScanSupport
}

/** Test hook: forget the cached pgvector capability lookup. */
export function resetIterativeScanSupportCache(): void {
  iterativeScanSupport = null
}

/** Escapes LIKE wildcard characters so a query is matched as literal text. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// How many times `limit` candidates searchArticles reads before dropping exact copies.
const DUPLICATE_OVERFETCH = 3

// `minScore` defaults to the match bar every answer path uses. Only the
// website widget asks for less, to find near misses (getWidgetKBContext).
//
// Superseded articles are never used for answers, so they are always left out.
// The dashboard search goes through here too and shows what answers would draw
// on; the article list's Superseded filter is where the team finds them.
export async function searchArticles(
  vector: number[],
  limit = 10,
  orgId: number,
  minScore = KB_MATCH_THRESHOLD
): Promise<KBSearchResult[]> {
  const distance = cosineDistance(kbArticles.embeddingVec, vector)
  const maxDistance = 1 - minScore

  const iterative = await supportsIterativeScan()

  const rows = await getDb().transaction(async (tx) => {
    // Per-scan settings in one statement (is_local = true, so they end with the
    // transaction). strict_order keeps exact distance ordering while the index
    // keeps scanning past rows the org/published/model filters discard.
    // ef_search exists on every pgvector build with HNSW; iterative_scan only
    // on the versions detected above.
    await tx.execute(
      iterative
        ? sql`select set_config('hnsw.ef_search', ${String(HNSW_EF_SEARCH)}, true), set_config('hnsw.iterative_scan', 'strict_order', true)`
        : sql`select set_config('hnsw.ef_search', ${String(HNSW_EF_SEARCH)}, true)`
    )

    return tx
      .select({ article: kbArticles, distance })
      .from(kbArticles)
      .where(
        and(
          eq(kbArticles.published, 1),
          eq(kbArticles.orgId, orgId),
          ne(kbArticles.reviewState, 'superseded'),
          isNotNull(kbArticles.embeddingVec),
          // Only rows on the workspace's pinned embedding model: a row from any
          // other model is skipped until the re-embed job moves it, so two
          // models never meet in one similarity score (lib/ai/embedding-pin.ts).
          sql`${kbArticles.model} = (SELECT embedding_model_in_use FROM orgs WHERE id = ${orgId})`,
          sql`${distance} <= ${maxDistance}`
        )
      )
      .orderBy(distance)
      // More than asked for, so that after exact copies are dropped there are
      // still `limit` different articles to return.
      .limit(limit * DUPLICATE_OVERFETCH)
  })

  // Exact copies score identically and sit side by side, so without this one
  // article imported twice would fill every slot and push out different ones.
  // The best-ranked copy stays.
  return dropExactDuplicates(
    rows.map((r) => ({
      ...toArticle(r.article),
      score: 1 - Number(r.distance),
    })),
    limit
  )
}

/** Literal text search. Leaves out superseded articles the same way searchArticles does. */
export async function textSearchArticles(query: string, limit = 10, orgId: number): Promise<KBArticle[]> {
  const pattern = `%${escapeLikePattern(query)}%`
  const rows = await getDb()
    .select()
    .from(kbArticles)
    .where(
      and(
        eq(kbArticles.published, 1),
        eq(kbArticles.orgId, orgId),
        ne(kbArticles.reviewState, 'superseded'),
        or(ilike(kbArticles.question, pattern), ilike(kbArticles.answer, pattern))
      )
    )
    .orderBy(desc(kbArticles.updatedAt))
    .limit(limit)
  return rows.map(toArticle)
}

/**
 * Adds one article made by a source sync (the GitHub and Notion importers). Its
 * history event is an automated one: origin 'sync', no actor. File and URL
 * imports go through createArticleFromSourceWithinCap, which records 'import'.
 */
export async function createArticleFromSource(
  input: {
    question: string
    answer: string
    embedding: number[]
    model: string
    sourceId: number
    sourcePage?: number
    // Only the Notion importer passes this (0). Omitted everywhere else, so
    // the column default (1) applies and every other source stays published.
    published?: 0 | 1
  },
  orgId: number
): Promise<KBArticle> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(kbArticles)
      .values({
        orgId,
        question: input.question,
        answer: input.answer,
        embedding: JSON.stringify(input.embedding),
        embeddingVec: input.embedding,
        model: input.model,
        sourceId: input.sourceId,
        sourcePage: input.sourcePage ?? null,
        ...(input.published !== undefined && { published: input.published }),
      })
      .returning()
    await recordArticleEvent(tx, {
      orgId,
      articleId: row.id,
      type: 'created',
      origin: 'sync',
      contentHash: contentHash(input.question, input.answer),
    })
    return toArticle(row)
  })
}

export async function countArticlesForSource(sourceId: number, orgId: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(kbArticles)
    .where(and(eq(kbArticles.sourceId, sourceId), eq(kbArticles.orgId, orgId)))
  return row?.n ?? 0
}

export async function getArticleBySourceAndPage(sourceId: number, sourcePage: number, orgId: number): Promise<KBArticle | null> {
  const [row] = await getDb()
    .select()
    .from(kbArticles)
    .where(and(eq(kbArticles.sourceId, sourceId), eq(kbArticles.sourcePage, sourcePage), eq(kbArticles.orgId, orgId)))
    .limit(1)
  return row ? toArticle(row) : null
}

export async function upsertArticleFromSource(
  input: {
    question: string
    answer: string
    embedding: number[]
    model: string
    sourceId: number
    sourcePage: number
  },
  orgId: number
): Promise<KBArticle> {
  const existing = await getArticleBySourceAndPage(input.sourceId, input.sourcePage, orgId)
  if (existing) {
    return getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(kbArticles)
        .set({
          question: input.question,
          answer: input.answer,
          embedding: JSON.stringify(input.embedding),
          embeddingVec: input.embedding,
          model: input.model,
          // A fresh vector supersedes anything the re-embed job staged from
          // the old text (lib/kb/embedding-migration.ts).
          embeddingNext: null,
          embeddingVecNext: null,
          modelNext: null,
          published: 1,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(kbArticles.id, existing.id))
        .returning()

      // A sync rewrites every page it visits, most of them unchanged. Only a
      // change to the words is recorded, as an automated edit with no actor.
      const hash = contentHash(input.question, input.answer)
      if (hash !== contentHash(existing.question, existing.answer)) {
        await recordArticleEvent(tx, {
          orgId,
          articleId: existing.id,
          type: 'edited',
          origin: 'sync',
          contentHash: hash,
        })
      }
      return toArticle(row)
    })
  }
  return createArticleFromSource(input, orgId)
}

export async function deleteArticleBySourceAndPage(sourceId: number, sourcePage: number, orgId: number): Promise<void> {
  await getDb()
    .delete(kbArticles)
    .where(and(eq(kbArticles.sourceId, sourceId), eq(kbArticles.sourcePage, sourcePage), eq(kbArticles.orgId, orgId)))
}

export async function deleteArticle(id: number, orgId: number): Promise<void> {
  await getDb()
    .delete(kbArticles)
    .where(and(eq(kbArticles.id, id), eq(kbArticles.orgId, orgId)))
}

export async function getKBContext(vector: number[], k = 3, orgId: number): Promise<PriorAnswer[]> {
  const results = await searchArticles(vector, k, orgId)
  return results.map((a) => ({ summary: a.question, answer: a.answer, articleId: a.id }))
}

/**
 * The website widget's lookup: the articles it would hand the assistant for a
 * question, with scores, and whether any cleared the match bar (strong
 * matches) or these are near misses (lib/kb/widget-context.ts). The Knowledge
 * coverage tester calls this too, so it shows exactly what the widget sees.
 */
export async function widgetLookup(vector: number[], k: number, orgId: number): Promise<{ results: KBSearchResult[]; matched: boolean }> {
  return chooseWidgetContext(await searchArticles(vector, k, orgId, KB_NEAR_MISS_FLOOR))
}

/** Knowledge-base context for the website widget, from widgetLookup. */
export async function getWidgetKBContext(vector: number[], k: number, orgId: number): Promise<WidgetKBContext> {
  const { results, matched } = await widgetLookup(vector, k, orgId)
  return {
    articles: results.map((a) => ({ summary: a.question, answer: a.answer, articleId: a.id })),
    matched,
  }
}
