import { embed, embedMany } from 'ai'
import { embeddingModel, resolveEmbedding, DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/models'

export const EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL

// Dimension of kb_articles.embedding_vec; defined with the platform models
// (lib/ai/platform-models.ts), which size every platform embedding to it.
export { KB_EMBEDDING_DIMENSIONS } from '@/lib/ai/platform-models'

/**
 * Embed a piece of text and report which model produced the vector. Callers
 * that store the vector must record that model: search only compares
 * vectors from the workspace's pinned model (lib/ai/embedding-pin.ts).
 * Caller is responsible for combining the fields worth embedding (e.g.
 * summary + content) into `text`.
 */
export async function embedTextWithModel(text: string, orgId?: number): Promise<{ embedding: number[]; model: string }> {
  const { model, modelId } = await resolveEmbedding(EMBEDDING_MODEL, orgId)
  const { embedding } = await embed({ model, value: text })
  return { embedding, model: modelId }
}

/** Embed a piece of text into a vector, for callers that only search with it. */
export async function embedText(text: string, orgId?: number): Promise<number[]> {
  return (await embedTextWithModel(text, orgId)).embedding
}

/**
 * Resolve the org's embedding provider without calling it. Throws
 * NoAIProviderConfiguredError when the org has no usable provider, including
 * when its included knowledge-base processing is used up
 * (PlatformBudgetExhaustedError), so bulk-import paths can refuse up front,
 * before spending crawl or parse work or creating source rows.
 */
export async function assertEmbeddingAvailable(orgId: number): Promise<void> {
  await embeddingModel(EMBEDDING_MODEL, orgId)
}

/**
 * Embed several texts in one call, for work that compares texts with each other
 * and stores nothing (source support's similarity check). Returns the vectors
 * in the order given and the tokens the provider reported, so the cost can be
 * recorded. Uses the workspace's own embedding provider, or its included
 * usage, exactly like every other embedding call.
 */
export async function embedTexts(
  texts: string[],
  orgId?: number
): Promise<{ embeddings: number[][]; tokens: number; model: string }> {
  const { model, modelId } = await resolveEmbedding(EMBEDDING_MODEL, orgId)
  const { embeddings, usage } = await embedMany({ model, values: texts })
  return { embeddings, tokens: usage?.tokens ?? 0, model: modelId }
}
