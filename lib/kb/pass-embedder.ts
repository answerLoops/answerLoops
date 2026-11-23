import { embed } from 'ai'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { embeddingTargetFor } from '@/lib/ai/embedding-pin'
import { getPlatformModel } from '@/lib/ai/platform-models'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/model-defaults'
import { getDeploymentMode } from '@/lib/billing/plans'
import { getBillingTier } from '@/lib/billing/platform-ai-budget'
import { passEmbeddingModel } from '@/lib/kb/embedding-migration'

/**
 * Who pays for background passes that redo existing knowledge-base content
 * (re-titling earlier page imports, re-processing synced repo docs under new
 * cleanup rules): the workspace's own embedding key when it brings one or the
 * install is self-hosted, and our key, never charged to included usage, for a
 * workspace on the included model with a live subscription. Anyone else
 * keeps their content as it is.
 */

/** Which embedding model this workspace would re-embed with, and whether its owner's key pays. */
export async function resolvePassWorkspace(orgId: number) {
  const cfg = await getOrgAIConfig(orgId)
  const selfHosted = getDeploymentMode() === 'self-hosted'
  const target = embeddingTargetFor(cfg, selfHosted ? DEFAULT_EMBEDDING_MODEL : getPlatformModel('embedding'))
  return { cfg, selfHosted, target, ownerRuns: !!target && (target.own || selfHosted) }
}

/**
 * Whether the workspace is part-way through moving to another embedding model:
 * its target differs from its pin, some article is off the pin, or the
 * re-embed job holds its lease. Re-embedding now would race that job.
 */
export async function isMigrating(orgId: number, targetModel: string): Promise<{ migrating: boolean; pinned: string | null }> {
  const rows = (await getDb().execute(sql`
    SELECT o.embedding_model_in_use AS pinned,
      (o.embedding_migration_lease_until IS NOT NULL AND o.embedding_migration_lease_until > now()) AS leased,
      EXISTS (SELECT 1 FROM kb_articles a WHERE a.org_id = o.id AND a.model IS DISTINCT FROM o.embedding_model_in_use) AS stray
    FROM orgs o WHERE o.id = ${orgId}
  `)) as unknown as { pinned: string | null; leased: boolean; stray: boolean }[]
  const row = rows[0]
  if (!row || !row.pinned) return { migrating: true, pinned: null }
  return { migrating: row.pinned !== targetModel || row.leased || row.stray, pinned: row.pinned }
}

export type Embedder = (text: string) => Promise<{ embedding: number[]; model: string }>

/**
 * The embedder for re-processing this workspace's existing content, or null
 * when nobody should pay for it right now (included model without a live
 * subscription) or a model switch is in progress. `free` is true when it runs
 * on our key. Vectors always come from the workspace's pinned model.
 */
export async function reprocessEmbedder(orgId: number): Promise<{ embed: Embedder; free: boolean } | null> {
  const { cfg, selfHosted, target, ownerRuns } = await resolvePassWorkspace(orgId)
  if (!target) return null
  if (!ownerRuns && !(await getBillingTier(orgId))) return null
  const { migrating, pinned } = await isMigrating(orgId, target.modelId)
  if (migrating || !pinned) return null
  const model = passEmbeddingModel(cfg, { modelId: pinned, own: target.own }, selfHosted)
  return {
    free: !ownerRuns,
    embed: async (text) => {
      const { embedding } = await embed({ model, value: text })
      return { embedding, model: pinned }
    },
  }
}

/** Whether a background re-processing pass for this workspace would run on our key. */
export async function isFreeReprocessCandidate(orgId: number): Promise<boolean> {
  return (await reprocessEmbedder(orgId))?.free === true
}
