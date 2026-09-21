import { embed } from 'ai'
import { embeddingModel, DEFAULT_EMBEDDING_MODEL, type ModelPurpose } from '@/lib/ai/models'

export const EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL

/**
 * Dimension of kb_articles.embedding_vec (lib/db/schema.ts), fixed
 * platform-wide so a single pgvector index can cover every org regardless
 * of which embedding_model an org has configured. text-embedding-3-small
 * (the platform default) and text-embedding-ada-002 both return this size
 * natively. An org that configures a different-dimension model (e.g.
 * text-embedding-3-large's default 3072) will get a hard failure creating
 * KB articles — Postgres rejects a wrong-length insert into a vector(1536)
 * column — rather than a silently-unindexed article. See lib/db/schema.ts's
 * comment on embeddingVec.
 */
export const KB_EMBEDDING_DIMENSIONS = 1536

/**
 * Embed a piece of text into a vector. Caller is responsible for combining the
 * fields worth embedding (e.g. summary + content) into `text`.
 */
export async function embedText(text: string, orgId?: number, purpose: ModelPurpose = 'production'): Promise<number[]> {
  const { embedding } = await embed({
    model: await embeddingModel(EMBEDDING_MODEL, orgId, purpose),
    value: text,
  })
  return embedding
}
