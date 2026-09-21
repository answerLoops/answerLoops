import { eq, and, desc, sql, or, like, isNotNull, cosineDistance } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticles, tickets } from '../schema'
import type { KBArticle, KBSearchResult, PriorAnswer } from '@/types'

export const KB_MATCH_THRESHOLD = 0.45

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

export async function getArticle(id: number): Promise<KBArticle | null> {
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
export async function searchArticles(vector: number[], limit = 10, orgId: number): Promise<KBSearchResult[]> {
  const distance = cosineDistance(kbArticles.embeddingVec, vector)
  const maxDistance = 1 - KB_MATCH_THRESHOLD

  const rows = await getDb()
    .select({ article: kbArticles, distance })
    .from(kbArticles)
    .where(
      and(
        eq(kbArticles.published, 1),
        eq(kbArticles.orgId, orgId),
        isNotNull(kbArticles.embeddingVec),
        sql`${distance} <= ${maxDistance}`
      )
    )
    .orderBy(distance)
    .limit(limit)

  return rows.map((r) => ({
    ...toArticle(r.article),
    score: 1 - Number(r.distance),
  }))
}

export async function textSearchArticles(query: string, limit = 10, orgId: number): Promise<KBArticle[]> {
  const pattern = `%${query}%`
  const rows = await getDb()
    .select()
    .from(kbArticles)
    .where(
      and(
        eq(kbArticles.published, 1),
        eq(kbArticles.orgId, orgId),
        or(like(kbArticles.question, pattern), like(kbArticles.answer, pattern))
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
  return results.map((a) => ({ summary: a.question, answer: a.answer }))
}
