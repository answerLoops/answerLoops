import { eq, and, desc, sql, or, ilike, isNotNull, cosineDistance } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticles, tickets } from '../schema'
import type { KBArticle, KBSearchResult, PriorAnswer } from '@/types'

export const KB_MATCH_THRESHOLD = 0.45

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
  },
  orgId: number
): Promise<KBArticle> {
  const db = getDb()

  if (input.sourceTicketId != null) {
    const [existing] = await db
      .select({ id: kbArticles.id })
      .from(kbArticles)
      .where(and(eq(kbArticles.sourceTicketId, input.sourceTicketId), eq(kbArticles.orgId, orgId)))
      .limit(1)

    if (existing) {
      await db
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
      return (await getArticle(existing.id))!
    }
  }

  const [row] = await db
    .insert(kbArticles)
    .values({
      orgId,
      question: input.question,
      answer: input.answer,
      embedding: JSON.stringify(input.embedding),
      embeddingVec: input.embedding,
      model: input.model,
      sourceTicketId: input.sourceTicketId ?? null,
    })
    .returning()

  return toArticle(row)
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

export async function listArticles(publishedOnly = true, orgId: number): Promise<KBArticle[]> {
  const conditions = publishedOnly
    ? and(eq(kbArticles.published, 1), eq(kbArticles.orgId, orgId))
    : eq(kbArticles.orgId, orgId)

  // Joined so the UI can link to the source ticket's user-facing number
  // (tickets.org_ticket_number) rather than the internal DB id.
  const rows = await getDb()
    .select({ article: kbArticles, sourceTicketNumber: tickets.orgTicketNumber })
    .from(kbArticles)
    .leftJoin(tickets, eq(tickets.id, kbArticles.sourceTicketId))
    .where(conditions)
    .orderBy(desc(kbArticles.updatedAt))
  return rows.map((r) => ({ ...toArticle(r.article), source_ticket_number: r.sourceTicketNumber ?? null }))
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

export async function searchArticles(vector: number[], limit = 10, orgId: number): Promise<KBSearchResult[]> {
  const distance = cosineDistance(kbArticles.embeddingVec, vector)
  const maxDistance = 1 - KB_MATCH_THRESHOLD

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
          isNotNull(kbArticles.embeddingVec),
          // Only rows on the workspace's pinned embedding model: a row from any
          // other model is skipped until the re-embed job moves it, so two
          // models never meet in one similarity score (lib/ai/embedding-pin.ts).
          sql`${kbArticles.model} = (SELECT embedding_model_in_use FROM orgs WHERE id = ${orgId})`,
          sql`${distance} <= ${maxDistance}`
        )
      )
      .orderBy(distance)
      .limit(limit)
  })

  return rows.map((r) => ({
    ...toArticle(r.article),
    score: 1 - Number(r.distance),
  }))
}

export async function textSearchArticles(query: string, limit = 10, orgId: number): Promise<KBArticle[]> {
  const pattern = `%${escapeLikePattern(query)}%`
  const rows = await getDb()
    .select()
    .from(kbArticles)
    .where(
      and(
        eq(kbArticles.published, 1),
        eq(kbArticles.orgId, orgId),
        or(ilike(kbArticles.question, pattern), ilike(kbArticles.answer, pattern))
      )
    )
    .orderBy(desc(kbArticles.updatedAt))
    .limit(limit)
  return rows.map(toArticle)
}

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
  const [row] = await getDb()
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
  return toArticle(row)
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
    const [row] = await getDb()
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
    return toArticle(row)
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
