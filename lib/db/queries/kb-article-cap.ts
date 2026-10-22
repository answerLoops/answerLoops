import { eq, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticles } from '../schema'
import { recordArticleEvent } from './kb-events'
import { contentHash } from '@/lib/kb/revision'

/** Thrown when an article cannot be added because the workspace is at its cap. */
export class ArticleCapReachedError extends Error {
  constructor() {
    super('Knowledge base is at its article limit')
    this.name = 'ArticleCapReachedError'
  }
}

// Either a database or an open transaction; both can run these statements.
type Executor = Pick<ReturnType<typeof getDb>, 'execute' | 'select'>

// Namespace half of the two-key advisory lock, keeping the per-org lock below
// separate from other advisory locks.
const CAP_LOCK_NAMESPACE = 0x6b62_6361 // "kbca"

/**
 * Takes the per-org lock for the rest of the surrounding transaction and
 * throws ArticleCapReachedError when the workspace already holds `cap`
 * articles. Every path that adds a row calls this inside its own transaction
 * before inserting, so concurrent adds for one workspace stay within the cap.
 */
export async function assertWithinArticleCap(tx: Executor, orgId: number, cap: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CAP_LOCK_NAMESPACE}, ${orgId})`)
  const [row] = await tx
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(kbArticles)
    .where(eq(kbArticles.orgId, orgId))
  if ((row?.n ?? 0) >= cap) throw new ArticleCapReachedError()
}

/**
 * Insert one source-linked article only while the org is still under `cap`.
 *
 * The count and the insert run in one transaction under a per-org lock, so
 * concurrent imports for the same workspace keep the total within the cap.
 * Returns the new article id, or null when the workspace is already at the cap
 * (nothing is written in that case). File uploads and URL imports use this, so
 * the history event it writes has origin 'import' and no actor.
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
    try {
      await assertWithinArticleCap(tx, orgId, cap)
    } catch (err) {
      if (err instanceof ArticleCapReachedError) return null
      throw err
    }

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
    await recordArticleEvent(tx, {
      orgId,
      articleId: created.id,
      type: 'created',
      origin: 'import',
      contentHash: contentHash(input.question, input.answer),
    })
    return created
  })
}
