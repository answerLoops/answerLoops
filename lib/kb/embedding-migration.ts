import { embedMany, type EmbeddingModel } from 'ai'
import { openai } from '@ai-sdk/openai'
import { ownEmbeddingModel } from '@/lib/ai/models'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { embeddingTargetFor } from '@/lib/ai/embedding-pin'
import { getPlatformModel, platformEmbedding, KB_EMBEDDING_DIMENSIONS } from '@/lib/ai/platform-models'
import { getDeploymentMode } from '@/lib/billing/plans'
import { getBillingTier } from '@/lib/billing/platform-ai-budget'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/model-defaults'
import { clampIngestContent } from '@/lib/ingest/limits'
import { logger } from '@/lib/logger'

const MOD = 'kb/embedding-migration'
const BATCH = 100

/**
 * Re-embeds a workspace's knowledge base and ticket vectors onto its target
 * embedding model, from the text already stored, then switches its pin
 * (lib/ai/embedding-pin.ts) in one transaction. Until then every query and
 * write keeps using the pinned model, so search keeps working throughout and
 * never compares vectors from two models. Not charged to included usage: a
 * platform model change is ours to pay for (and only for workspaces with a
 * live subscription), and a workspace's own model change runs on its own key.
 *
 * Each workspace is leased through a row while a pass runs (a session
 * advisory lock would leak across the connection pool), and one whose passes
 * keep failing backs off exponentially so it can't take every sweep's slots.
 */

/** How long a pass may hold a workspace before another worker can take it; renewed per batch. */
const LEASE = sql`interval '15 minutes'`
// Backoff after N consecutive failures (in listMigrationCandidates):
// 5 minutes × 2^N, with N capped at 8, about 21 hours.

/** Workspaces whose pin differs from their target, or that hold rows not on their pin, least recently attempted first. */
export async function listMigrationCandidates(platformModel: string, limit = 50): Promise<number[]> {
  const rows = (await getDb().execute(sql`
    SELECT o.id AS org_id FROM orgs o LEFT JOIN ai_configs c ON c.org_id = o.id
    WHERE o.embedding_model_in_use IS NOT NULL
      AND (o.embedding_migration_lease_until IS NULL OR o.embedding_migration_lease_until < now())
      AND (o.embedding_migration_failures = 0 OR o.embedding_migration_attempted_at IS NULL
        OR o.embedding_migration_attempted_at < now() - interval '5 minutes' * power(2, LEAST(o.embedding_migration_failures, 8)))
      AND (
        o.embedding_model_in_use <> CASE
          WHEN c.embedding_base_url IS NOT NULL OR c.embedding_api_key IS NOT NULL OR (c.chat_provider = 'openai' AND c.chat_api_key IS NOT NULL)
          THEN COALESCE(NULLIF(c.embedding_model, ''), ${DEFAULT_EMBEDDING_MODEL})
          ELSE ${platformModel} END
        OR EXISTS (SELECT 1 FROM kb_articles a WHERE a.org_id = o.id AND a.model <> o.embedding_model_in_use)
        OR EXISTS (SELECT 1 FROM ticket_embeddings te JOIN tickets t ON t.id = te.ticket_id WHERE t.org_id = o.id AND te.model <> o.embedding_model_in_use)
      )
    ORDER BY o.embedding_migration_attempted_at ASC NULLS FIRST, o.id LIMIT ${limit}
  `)) as unknown as { org_id: number }[]
  return rows.map((r) => r.org_id)
}

/** Thrown when the embedding model's output cannot be stored in the knowledge-base vector column. */
export class EmbeddingConfigError extends Error {
  constructor(modelId: string, got: number) {
    super(
      `Embedding model "${modelId}" returns ${got}-dimension vectors, but the knowledge base stores ${KB_EMBEDDING_DIMENSIONS}. ` +
        `Choose an embedding model that outputs ${KB_EMBEDDING_DIMENSIONS} dimensions.`,
    )
    this.name = 'EmbeddingConfigError'
  }
}

/** Raised when the lease was taken over (it expired mid-pass); the pass stops without writing further. */
class LeaseLostError extends Error {
  constructor(orgId: number) {
    super(`embedding migration lease for org ${orgId} is no longer held`)
    this.name = 'LeaseLostError'
  }
}

/**
 * The lease is identified by its expiry timestamp: renew and release only act
 * while the row still carries the value this pass last wrote, so a pass whose
 * lease expired and was taken by another worker cannot extend or clear theirs.
 */
interface Lease {
  token: string
}

/** Takes the workspace's lease if no live one is held; records the attempt. */
async function acquireLease(orgId: number): Promise<Lease | null> {
  const rows = (await getDb().execute(sql`
    UPDATE orgs SET embedding_migration_lease_until = now() + ${LEASE}, embedding_migration_attempted_at = now()
    WHERE id = ${orgId} AND (embedding_migration_lease_until IS NULL OR embedding_migration_lease_until < now())
    RETURNING extract(epoch from embedding_migration_lease_until)::text AS token
  `)) as unknown as { token: string }[]
  return rows[0] ? { token: rows[0].token } : null
}

async function renewLease(orgId: number, lease: Lease): Promise<void> {
  const rows = (await getDb().execute(sql`
    UPDATE orgs SET embedding_migration_lease_until = now() + ${LEASE}
    WHERE id = ${orgId} AND extract(epoch from embedding_migration_lease_until)::text = ${lease.token}
    RETURNING extract(epoch from embedding_migration_lease_until)::text AS token
  `)) as unknown as { token: string }[]
  if (!rows[0]) throw new LeaseLostError(orgId)
  lease.token = rows[0].token
}

/** Releases the lease while it is still ours; a failed pass increments the failure count for backoff, a clean one resets it. */
async function releaseLease(orgId: number, lease: Lease, ok: boolean): Promise<void> {
  await getDb().execute(ok
    ? sql`UPDATE orgs SET embedding_migration_lease_until = NULL, embedding_migration_failures = 0
          WHERE id = ${orgId} AND extract(epoch from embedding_migration_lease_until)::text = ${lease.token}`
    : sql`UPDATE orgs SET embedding_migration_lease_until = NULL, embedding_migration_failures = embedding_migration_failures + 1
          WHERE id = ${orgId} AND extract(epoch from embedding_migration_lease_until)::text = ${lease.token}`)
}

// A staged vector is only valid for the text it was built from. The staging
// write records a fingerprint of the stored text (computed in SQL from the same
// columns), and promotion requires it to still match, so a row edited after it
// was read is re-staged instead of going live with a stale vector.
const ARTICLE_TEXT_HASH = sql`md5(question || E'\n\n' || answer)`
const TICKET_TEXT_HASH = sql`md5(COALESCE(t.ai_summary, '') || E'\n\n' || t.content)`

async function stageArticles(orgId: number, lease: Lease, target: string, model: EmbeddingModel): Promise<number> {
  let staged = 0
  let checked = false
  for (;;) {
    const rows = (await getDb().execute(sql`
      SELECT id, question, answer FROM kb_articles
      WHERE org_id = ${orgId} AND model <> ${target}
        AND (model_next IS DISTINCT FROM ${target} OR embedding_next_hash IS DISTINCT FROM ${ARTICLE_TEXT_HASH})
      ORDER BY id LIMIT ${BATCH}
    `)) as unknown as { id: number; question: string; answer: string }[]
    if (rows.length === 0) return staged
    await renewLease(orgId, lease)
    // Same text every KB writer embeds (lib/ai/embed.ts callers).
    const { embeddings } = await embedMany({ model, values: rows.map((r) => `${r.question}\n\n${r.answer}`) })
    if (!checked) {
      // Fail before any row is staged if the model's output cannot fit the vector column.
      const got = embeddings[0]?.length ?? 0
      if (got !== KB_EMBEDDING_DIMENSIONS) throw new EmbeddingConfigError(target, got)
      checked = true
    }
    let batchStaged = 0
    for (let i = 0; i < rows.length; i++) {
      const v = JSON.stringify(embeddings[i])
      // Only stage if the row still holds the text that was embedded.
      const done = (await getDb().execute(sql`
        UPDATE kb_articles
        SET embedding_next = ${v}, embedding_vec_next = ${v}::vector, model_next = ${target}, embedding_next_hash = ${ARTICLE_TEXT_HASH}
        WHERE id = ${rows[i].id} AND org_id = ${orgId} AND question = ${rows[i].question} AND answer = ${rows[i].answer}
        RETURNING id
      `)) as unknown as { id: number }[]
      batchStaged += done.length
    }
    staged += batchStaged
    // Every row in the batch changed under us: stop here and let the next sweep pick them up.
    if (batchStaged === 0) return staged
  }
}

async function stageTickets(orgId: number, lease: Lease, target: string, model: EmbeddingModel): Promise<number> {
  let staged = 0
  for (;;) {
    const rows = (await getDb().execute(sql`
      SELECT te.ticket_id AS id, COALESCE(t.ai_summary, '') AS summary, t.content AS content
      FROM ticket_embeddings te JOIN tickets t ON t.id = te.ticket_id
      WHERE t.org_id = ${orgId} AND te.model <> ${target}
        AND (te.model_next IS DISTINCT FROM ${target} OR te.vector_next_hash IS DISTINCT FROM ${TICKET_TEXT_HASH})
      ORDER BY te.ticket_id LIMIT ${BATCH}
    `)) as unknown as { id: number; summary: string; content: string }[]
    if (rows.length === 0) return staged
    await renewLease(orgId, lease)
    // Same text the ingest pipeline embeds (lib/ingest/pipeline.ts).
    const { embeddings } = await embedMany({ model, values: rows.map((r) => `${r.summary}\n\n${clampIngestContent(r.content)}`) })
    let batchStaged = 0
    for (let i = 0; i < rows.length; i++) {
      const done = (await getDb().execute(sql`
        UPDATE ticket_embeddings te
        SET vector_next = ${JSON.stringify(embeddings[i])}, model_next = ${target}, vector_next_hash = ${TICKET_TEXT_HASH}
        FROM tickets t
        WHERE t.id = te.ticket_id AND te.ticket_id = ${rows[i].id} AND t.org_id = ${orgId}
          AND COALESCE(t.ai_summary, '') = ${rows[i].summary} AND t.content = ${rows[i].content}
        RETURNING te.ticket_id AS id
      `)) as unknown as { id: number }[]
      batchStaged += done.length
    }
    staged += batchStaged
    if (batchStaged === 0) return staged
  }
}

/**
 * With the org row locked, moves staged vectors live and switches the pin,
 * but only once nothing is left unstaged: a row written after staging (still
 * on the old pin), or edited after its vector was staged, leaves the switch for
 * the next sweep, which stages it again.
 */
async function switchIfComplete(orgId: number, target: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM orgs WHERE id = ${orgId} FOR UPDATE`)
    const [left] = (await tx.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM kb_articles WHERE org_id = ${orgId} AND model <> ${target}
          AND (model_next IS DISTINCT FROM ${target} OR embedding_next_hash IS DISTINCT FROM ${ARTICLE_TEXT_HASH}))
      + (SELECT COUNT(*) FROM ticket_embeddings te JOIN tickets t ON t.id = te.ticket_id
          WHERE t.org_id = ${orgId} AND te.model <> ${target}
            AND (te.model_next IS DISTINCT FROM ${target} OR te.vector_next_hash IS DISTINCT FROM ${TICKET_TEXT_HASH})) AS remaining
    `)) as unknown as { remaining: number | string }[]
    if (Number(left?.remaining ?? 0) > 0) return false
    await tx.execute(sql`
      UPDATE kb_articles
      SET embedding = embedding_next, embedding_vec = embedding_vec_next, model = model_next, embedding_next = NULL, embedding_vec_next = NULL, model_next = NULL, embedding_next_hash = NULL
      WHERE org_id = ${orgId} AND model_next = ${target} AND embedding_next_hash = ${ARTICLE_TEXT_HASH}
    `)
    await tx.execute(sql`
      UPDATE ticket_embeddings te
      SET vector = vector_next, model = model_next, vector_next = NULL, model_next = NULL, vector_next_hash = NULL
      FROM tickets t WHERE t.id = te.ticket_id AND t.org_id = ${orgId} AND te.model_next = ${target}
        AND te.vector_next_hash = ${TICKET_TEXT_HASH}
    `)
    await tx.execute(sql`UPDATE orgs SET embedding_model_in_use = ${target} WHERE id = ${orgId}`)
    return true
  })
}

export async function runEmbeddingMigration(orgId: number): Promise<{ staged: number; switched: boolean }> {
  const lease = await acquireLease(orgId)
  if (!lease) return { staged: 0, switched: false }
  let ok = false
  try {
    const cfg = await getOrgAIConfig(orgId)
    const selfHosted = getDeploymentMode() === 'self-hosted'
    const target = embeddingTargetFor(cfg, selfHosted ? DEFAULT_EMBEDDING_MODEL : getPlatformModel('embedding'))
    if (!target) return { staged: 0, switched: false }

    // Moving onto the platform model runs on our key: only for a workspace
    // that still has a live subscription. Otherwise this counts as a failed
    // pass, so the workspace backs off instead of being retried every sweep.
    if (!target.own && !selfHosted && !(await getBillingTier(orgId))) {
      logger.info('embedding migration skipped: no live subscription', { module: MOD, orgId })
      return { staged: 0, switched: false }
    }

    let model: EmbeddingModel
    if (target.own && cfg) {
      model = ownEmbeddingModel(cfg, target.modelId)
    } else {
      model = selfHosted ? openai.embedding(target.modelId) : platformEmbedding(target.modelId)
    }

    const staged = (await stageArticles(orgId, lease, target.modelId, model)) + (await stageTickets(orgId, lease, target.modelId, model))
    const switched = await switchIfComplete(orgId, target.modelId)
    logger.info('embedding migration pass', { module: MOD, orgId, target: target.modelId, staged, switched })
    ok = true
    return { staged, switched }
  } finally {
    await releaseLease(orgId, lease, ok)
  }
}
