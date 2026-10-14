import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import type { OrgAIConfig } from '@/lib/db/queries/ai-config'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/model-defaults'

/**
 * Each workspace is pinned (orgs.embedding_model_in_use) to the embedding
 * model its stored vectors belong to. Queries and writes keep using that
 * model until the re-embed job (lib/kb/embedding-migration.ts) has moved
 * every vector to the workspace's target model and switched the pin, so a
 * model change never mixes two vector spaces in one search.
 */

export interface EmbeddingTarget {
  modelId: string
  own: boolean
}

/** Whether the workspace embeds with its own provider: an embedding key, an OpenAI chat key, or a custom endpoint. */
export function hasOwnEmbeddingConfig(cfg: OrgAIConfig | null): boolean {
  if (!cfg) return false
  const embKey = cfg.embedding_api_key ?? (cfg.chat_provider === 'openai' ? cfg.chat_api_key : null)
  return !!(embKey || cfg.embedding_base_url)
}

/** The model a workspace's vectors should be on. Null when it has no own config and the platform model is unusable. */
export function embeddingTargetFor(cfg: OrgAIConfig | null, platformModel: string | null): EmbeddingTarget | null {
  if (cfg && hasOwnEmbeddingConfig(cfg)) return { modelId: cfg.embedding_model || DEFAULT_EMBEDDING_MODEL, own: true }
  return platformModel ? { modelId: platformModel, own: false } : null
}

export async function getPinnedModel(orgId: number): Promise<string | null> {
  const rows = (await getDb().execute(sql`
    SELECT embedding_model_in_use AS pin FROM orgs WHERE id = ${orgId}
  `)) as unknown as { pin: string | null }[]
  return rows[0]?.pin ?? null
}

/** Pins a workspace that has no vectors yet. A concurrent first write that won the race keeps its pin. */
export async function ensurePin(orgId: number, modelId: string): Promise<string> {
  await getDb().execute(sql`
    UPDATE orgs SET embedding_model_in_use = ${modelId} WHERE id = ${orgId} AND embedding_model_in_use IS NULL
  `)
  return (await getPinnedModel(orgId)) ?? modelId
}
