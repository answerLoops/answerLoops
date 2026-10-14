import { embedMany, type EmbeddingModel } from 'ai'
import { openai, createOpenAI } from '@ai-sdk/openai'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { embeddingTargetFor } from '@/lib/ai/embedding-pin'
import { getPlatformModel, platformEmbedding } from '@/lib/ai/platform-models'
import { getDeploymentMode } from '@/lib/billing/plans'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/model-defaults'
import { createSafeProviderFetch } from '@/lib/ai/safe-provider-fetch'
import { clampIngestContent } from '@/lib/ingest/limits'
import { logger } from '@/lib/logger'

const MOD = 'kb/embedding-migration'
const BATCH = 100

/**
 * Re-embeds a workspace's knowledge base and ticket vectors onto its target
 * embedding model, from the text already stored, then switches its pin
 * (lib/ai/embedding-pin.ts) in one transaction. Until then every query and
 * write keeps using the pinned model, so search keeps working throughout and
 * never compares vectors from two models. Unmetered: a platform model change
 * is ours to pay for, and a workspace's own model change runs on its own key.
 */

/** Workspaces whose pin differs from their target, or that hold rows not on their pin. */
export async function listMigrationCandidates(platformModel: string, limit = 50): Promise<number[]> {
  const rows = (await getDb().execute(sql`
    SELECT o.id AS org_id FROM orgs o LEFT JOIN ai_configs c ON c.org_id = o.id
    WHERE o.embedding_model_in_use IS NOT NULL AND (
      o.embedding_model_in_use <> CASE
        WHEN c.embedding_base_url IS NOT NULL OR c.embedding_api_key IS NOT NULL OR (c.chat_provider = 'openai' AND c.chat_api_key IS NOT NULL)
        THEN COALESCE(NULLIF(c.embedding_model, ''), ${DEFAULT_EMBEDDING_MODEL})
        ELSE ${platformModel} END
      OR EXISTS (SELECT 1 FROM kb_articles a WHERE a.org_id = o.id AND a.model <> o.embedding_model_in_use)
      OR EXISTS (SELECT 1 FROM ticket_embeddings te JOIN tickets t ON t.id = te.ticket_id WHERE t.org_id = o.id AND te.model <> o.embedding_model_in_use)
    )
    ORDER BY o.id LIMIT ${limit}
  `)) as unknown as { org_id: number }[]
  return rows.map((r) => r.org_id)
}

async function stageArticles(orgId: number, target: string, model: EmbeddingModel): Promise<number> {
  let staged = 0
  for (;;) {
    const rows = (await getDb().execute(sql`
      SELECT id, question, answer FROM kb_articles
      WHERE org_id = ${orgId} AND model <> ${target} AND model_next IS DISTINCT FROM ${target}
      ORDER BY id LIMIT ${BATCH}
    `)) as unknown as { id: number; question: string; answer: string }[]
    if (rows.length === 0) return staged
    // Same text every KB writer embeds (lib/ai/embed.ts callers).
    const { embeddings } = await embedMany({ model, values: rows.map((r) => `${r.question}\n\n${r.answer}`) })
    for (let i = 0; i < rows.length; i++) {
      const v = JSON.stringify(embeddings[i])
      await getDb().execute(sql`
        UPDATE kb_articles SET embedding_next = ${v}, embedding_vec_next = ${v}::vector, model_next = ${target} WHERE id = ${rows[i].id}
      `)
    }
    staged += rows.length
  }
}

async function stageTickets(orgId: number, target: string, model: EmbeddingModel): Promise<number> {
  let staged = 0
  for (;;) {
    const rows = (await getDb().execute(sql`
      SELECT te.ticket_id AS id, COALESCE(t.ai_summary, '') AS summary, t.content AS content
      FROM ticket_embeddings te JOIN tickets t ON t.id = te.ticket_id
      WHERE t.org_id = ${orgId} AND te.model <> ${target} AND te.model_next IS DISTINCT FROM ${target}
      ORDER BY te.ticket_id LIMIT ${BATCH}
    `)) as unknown as { id: number; summary: string; content: string }[]
    if (rows.length === 0) return staged
    // Same text the ingest pipeline embeds (lib/ingest/pipeline.ts).
    const { embeddings } = await embedMany({ model, values: rows.map((r) => `${r.summary}\n\n${clampIngestContent(r.content)}`) })
    for (let i = 0; i < rows.length; i++) {
      await getDb().execute(sql`
        UPDATE ticket_embeddings SET vector_next = ${JSON.stringify(embeddings[i])}, model_next = ${target} WHERE ticket_id = ${rows[i].id}
      `)
    }
    staged += rows.length
  }
}

/**
 * With the org row locked, moves staged vectors live and switches the pin,
 * but only once nothing is left unstaged: a row written after staging (still
 * on the old pin) leaves the switch for the next sweep, which stages it.
 */
async function switchIfComplete(orgId: number, target: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM orgs WHERE id = ${orgId} FOR UPDATE`)
    const [left] = (await tx.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM kb_articles WHERE org_id = ${orgId} AND model <> ${target} AND model_next IS DISTINCT FROM ${target})
      + (SELECT COUNT(*) FROM ticket_embeddings te JOIN tickets t ON t.id = te.ticket_id
          WHERE t.org_id = ${orgId} AND te.model <> ${target} AND te.model_next IS DISTINCT FROM ${target}) AS remaining
    `)) as unknown as { remaining: number | string }[]
    if (Number(left?.remaining ?? 0) > 0) return false
    await tx.execute(sql`
      UPDATE kb_articles
      SET embedding = embedding_next, embedding_vec = embedding_vec_next, model = model_next, embedding_next = NULL, embedding_vec_next = NULL, model_next = NULL
      WHERE org_id = ${orgId} AND model_next = ${target}
    `)
    await tx.execute(sql`
      UPDATE ticket_embeddings te
      SET vector = vector_next, model = model_next, vector_next = NULL, model_next = NULL
      FROM tickets t WHERE t.id = te.ticket_id AND t.org_id = ${orgId} AND te.model_next = ${target}
    `)
    await tx.execute(sql`UPDATE orgs SET embedding_model_in_use = ${target} WHERE id = ${orgId}`)
    return true
  })
}

export async function runEmbeddingMigration(orgId: number): Promise<{ staged: number; switched: boolean }> {
  const [lock] = (await getDb().execute(sql`
    SELECT pg_try_advisory_lock(hashtext('embedding-migration'), ${orgId}) AS locked
  `)) as unknown as { locked: boolean }[]
  if (!lock?.locked) return { staged: 0, switched: false }
  try {
    const cfg = await getOrgAIConfig(orgId)
    const selfHosted = getDeploymentMode() === 'self-hosted'
    const target = embeddingTargetFor(cfg, selfHosted ? DEFAULT_EMBEDDING_MODEL : getPlatformModel('embedding'))
    if (!target) return { staged: 0, switched: false }

    let model: EmbeddingModel
    if (target.own && cfg) {
      const embKey = cfg.embedding_api_key ?? (cfg.chat_provider === 'openai' ? cfg.chat_api_key : null)
      model = createOpenAI({
        apiKey: embKey ?? undefined,
        baseURL: cfg.embedding_base_url ?? undefined,
        ...(cfg.embedding_base_url ? { fetch: createSafeProviderFetch() } : {}),
      }).embedding(target.modelId)
    } else {
      model = selfHosted ? openai.embedding(target.modelId) : platformEmbedding(target.modelId)
    }

    const staged = (await stageArticles(orgId, target.modelId, model)) + (await stageTickets(orgId, target.modelId, model))
    const switched = await switchIfComplete(orgId, target.modelId)
    logger.info('embedding migration pass', { module: MOD, orgId, target: target.modelId, staged, switched })
    return { staged, switched }
  } finally {
    await getDb().execute(sql`SELECT pg_advisory_unlock(hashtext('embedding-migration'), ${orgId})`)
  }
}
