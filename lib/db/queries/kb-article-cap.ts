import { eq, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticles } from '../schema'

// Namespace half of the two-key advisory lock, keeping the per-org lock below
// separate from other advisory locks.
const CAP_LOCK_NAMESPACE = 0x6b62_6361 // "kbca"

/**
 * Insert one source-linked article only while the org is still under `cap`.
 *
 * The count and the insert run in one transaction under a per-org lock, so
 * concurrent imports for the same workspace keep the total within the cap.
 * Returns the new article id, or null when the workspace is already at the cap
 * (nothing is written in that case).
 */
export async function createArticleFromSourceWithinCap(
  input: {
    question: string
    answer: string
    embedding: number[]
    model: string
    sourceId: number
    sourcePage?: number
    published?: 0 | 1
  },
  orgId: number,
  cap: number,
): Promise<{ id: number } | null> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CAP_LOCK_NAMESPACE}, ${orgId})`)

    const [row] = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(kbArticles)
      .where(eq(kbArticles.orgId, orgId))
    if ((row?.n ?? 0) >= cap) return null

    const [created] = await tx
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
      .returning({ id: kbArticles.id })
    return created
  })
}
