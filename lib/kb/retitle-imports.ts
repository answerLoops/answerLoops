import { embedMany } from 'ai'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { recordArticleEvent } from '@/lib/db/queries/kb-events'
import { embeddingTargetFor } from '@/lib/ai/embedding-pin'
import { getPlatformModel, KB_EMBEDDING_DIMENSIONS } from '@/lib/ai/platform-models'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/model-defaults'
import { getDeploymentMode } from '@/lib/billing/plans'
import { getBillingTier } from '@/lib/billing/platform-ai-budget'
import { EmbeddingConfigError, passEmbeddingModel } from '@/lib/kb/embedding-migration'
import { retitledQuestion } from '@/lib/kb/retitle'
import { contentHash } from '@/lib/kb/revision'
import { logger } from '@/lib/logger'

/**
 * Re-titles sections from pages imported before section titles carried the
 * page. A new import titles each section "Pricing › Pro"; an older one holds
 * "Pro" alone, which a loosely worded question rarely finds. This pass puts
 * the page in front, built from the stored address (lib/kb/retitle.ts), and
 * re-embeds the section so search sees the new title. The answer text is
 * never touched.
 *
 * One source (one page) at a time, each in its own transaction, so a page is
 * either fully done or untouched. A title a person edited is left alone, and
 * every write is conditional on the title and text still being what the pass
 * read, so an edit made while the pass runs always wins.
 *
 * Who runs it: the bot's sweep for workspaces on the platform embedding model
 * with a live subscription, at our cost and never charged to included usage;
 * the workspace's owner (Settings) when it uses its own embedding key or the
 * install is self-hosted, on that key. Bookkeeping mirrors the re-embed job
 * (lib/kb/embedding-migration.ts): a leased row, attempt time, and backoff
 * for a workspace whose passes keep failing.
 */

const MOD = 'kb/retitle-imports'
const LEASE = sql`interval '15 minutes'`
const DEFAULT_MAX_SOURCES = 25

export type RetitleMode = 'scheduled' | 'owner'

export interface RetitleResult {
  retitled: number
  sourcesDone: number
  remainingSources: number
  /** Why nothing ran: not this mode's workspace, mid model switch, or another pass holds the lease. */
  skipped?: 'not-eligible' | 'migrating' | 'busy'
}

/** A model switch began after the pass checked; the current page is rolled back and the pass stops. */
class MigrationStartedError extends Error {
  constructor(orgId: number) {
    super(`an embedding model switch started for org ${orgId} during the re-title pass`)
    this.name = 'MigrationStartedError'
  }
}

class LeaseLostError extends Error {
  constructor(orgId: number) {
    super(`re-title lease for org ${orgId} is no longer held`)
    this.name = 'LeaseLostError'
  }
}

/** Workspaces with pages waiting, not leased and not backing off, least recently attempted first. Own-key workspaces are left to their owner. */
export async function listRetitleCandidates(limit = 50): Promise<number[]> {
  const rows = (await getDb().execute(sql`
    SELECT o.id AS org_id FROM orgs o LEFT JOIN ai_configs c ON c.org_id = o.id
    WHERE EXISTS (SELECT 1 FROM kb_sources s WHERE s.org_id = o.id AND s.file_type = 'url' AND s.titles_version = 0)
      AND (o.kb_retitle_lease_until IS NULL OR o.kb_retitle_lease_until < now())
      AND (o.kb_retitle_failures = 0 OR o.kb_retitle_attempted_at IS NULL
        OR o.kb_retitle_attempted_at < now() - interval '5 minutes' * power(2, LEAST(o.kb_retitle_failures, 8)))
      AND NOT COALESCE(c.embedding_base_url IS NOT NULL OR c.embedding_api_key IS NOT NULL OR (c.chat_provider = 'openai' AND c.chat_api_key IS NOT NULL), false)
    ORDER BY o.kb_retitle_attempted_at ASC NULLS FIRST, o.id LIMIT ${limit}
  `)) as unknown as { org_id: number }[]
  return rows.map((r) => r.org_id)
}

async function countRemaining(orgId: number): Promise<number> {
  const rows = (await getDb().execute(sql`
    SELECT count(*)::int AS n FROM kb_sources WHERE org_id = ${orgId} AND file_type = 'url' AND titles_version = 0
  `)) as unknown as { n: number }[]
  return Number(rows[0]?.n ?? 0)
}

/** Which embedding model this workspace would re-title with, and who may run it. */
async function resolveWorkspace(orgId: number) {
  const cfg = await getOrgAIConfig(orgId)
  const selfHosted = getDeploymentMode() === 'self-hosted'
  const target = embeddingTargetFor(cfg, selfHosted ? DEFAULT_EMBEDDING_MODEL : getPlatformModel('embedding'))
  return { cfg, selfHosted, target, ownerRuns: !!target && (target.own || selfHosted) }
}

/** What the owner's Settings action shows: whether it applies to this workspace, and how many pages are waiting. */
export async function retitleStatus(orgId: number): Promise<{ eligibleForOwnerRun: boolean; remainingSources: number }> {
  const { ownerRuns } = await resolveWorkspace(orgId)
  return { eligibleForOwnerRun: ownerRuns, remainingSources: await countRemaining(orgId) }
}

interface Lease {
  token: string
}

async function acquireLease(orgId: number): Promise<Lease | null> {
  const rows = (await getDb().execute(sql`
    UPDATE orgs SET kb_retitle_lease_until = now() + ${LEASE}, kb_retitle_attempted_at = now()
    WHERE id = ${orgId} AND (kb_retitle_lease_until IS NULL OR kb_retitle_lease_until < now())
    RETURNING extract(epoch from kb_retitle_lease_until)::text AS token
  `)) as unknown as { token: string }[]
  return rows[0] ? { token: rows[0].token } : null
}

async function renewLease(orgId: number, lease: Lease): Promise<void> {
  const rows = (await getDb().execute(sql`
    UPDATE orgs SET kb_retitle_lease_until = now() + ${LEASE}
    WHERE id = ${orgId} AND extract(epoch from kb_retitle_lease_until)::text = ${lease.token}
    RETURNING extract(epoch from kb_retitle_lease_until)::text AS token
  `)) as unknown as { token: string }[]
  if (!rows[0]) throw new LeaseLostError(orgId)
  lease.token = rows[0].token
}

/** Releases the lease while it is still ours; a failed pass counts towards backoff, a clean one resets it. */
async function releaseLease(orgId: number, lease: Lease, ok: boolean): Promise<void> {
  await getDb().execute(
    ok
      ? sql`UPDATE orgs SET kb_retitle_lease_until = NULL, kb_retitle_failures = 0
            WHERE id = ${orgId} AND extract(epoch from kb_retitle_lease_until)::text = ${lease.token}`
      : sql`UPDATE orgs SET kb_retitle_lease_until = NULL, kb_retitle_failures = kb_retitle_failures + 1
            WHERE id = ${orgId} AND extract(epoch from kb_retitle_lease_until)::text = ${lease.token}`
  )
}

/**
 * Whether the workspace is part-way through moving to another embedding model:
 * its target differs from its pin, some article is off the pin, or the
 * re-embed job holds its lease. Re-embedding now would race that job.
 */
async function isMigrating(orgId: number, targetModel: string): Promise<{ migrating: boolean; pinned: string | null }> {
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

export async function runRetitlePass(orgId: number, opts: { mode: RetitleMode; maxSources?: number }): Promise<RetitleResult> {
  const remainingAtStart = () => countRemaining(orgId)

  // The lease comes first, so every attempt is recorded, a skipped one too:
  // a workspace that isn't eligible then rotates behind the others in the
  // sweep's order instead of staying first in line forever.
  const lease = await acquireLease(orgId)
  if (!lease) return { retitled: 0, sourcesDone: 0, remainingSources: await remainingAtStart(), skipped: 'busy' }
  let ok = false
  try {
    const { cfg, selfHosted, target, ownerRuns } = await resolveWorkspace(orgId)
    // Scheduled runs cover subscribed platform-model workspaces only; anything
    // else is the owner's to run. Not a failure, so no backoff.
    const scheduledRuns = !!target && !ownerRuns
    if (opts.mode === 'scheduled' ? !scheduledRuns || !(await getBillingTier(orgId)) : !ownerRuns) {
      ok = true
      return { retitled: 0, sourcesDone: 0, remainingSources: await remainingAtStart(), skipped: 'not-eligible' }
    }

    const { migrating, pinned } = await isMigrating(orgId, target!.modelId)
    if (migrating || !pinned) {
      ok = true
      return { retitled: 0, sourcesDone: 0, remainingSources: await remainingAtStart(), skipped: 'migrating' }
    }
    const model = passEmbeddingModel(cfg, { modelId: pinned, own: target!.own }, selfHosted)

    const sources = (await getDb().execute(sql`
      SELECT id, filename FROM kb_sources
      WHERE org_id = ${orgId} AND file_type = 'url' AND titles_version = 0
      ORDER BY id LIMIT ${opts.maxSources ?? DEFAULT_MAX_SOURCES}
    `)) as unknown as { id: number; filename: string }[]

    let retitled = 0
    let sourcesDone = 0
    for (const source of sources) {
      await renewLease(orgId, lease)
      const articles = (await getDb().execute(sql`
        SELECT a.id, a.question, a.answer FROM kb_articles a
        WHERE a.org_id = ${orgId} AND a.source_id = ${source.id}
          AND NOT EXISTS (SELECT 1 FROM kb_article_events e WHERE e.article_id = a.id AND e.type = 'edited' AND e.origin = 'manual')
        ORDER BY a.id
      `)) as unknown as { id: number; question: string; answer: string }[]
      const changes = articles
        .map((a) => ({ ...a, next: retitledQuestion(source.filename, a.question) }))
        .filter((a) => a.next !== a.question)

      let embeddings: number[][] = []
      if (changes.length > 0) {
        // Same text every knowledge-base writer embeds (lib/ai/embed.ts callers).
        ;({ embeddings } = await embedMany({ model, values: changes.map((c) => `${c.next}\n\n${c.answer}`) }))
        const got = embeddings[0]?.length ?? 0
        if (got !== KB_EMBEDDING_DIMENSIONS) throw new EmbeddingConfigError(pinned, got)
      }

      const now = new Date().toISOString()
      let written: number
      try {
        written = await getDb().transaction(async (tx) => {
          // Holds off the re-embed job's switch (it locks this row FOR UPDATE)
          // until this page is written, and stops if a switch began after the
          // check above: vectors from the old model must not land after the pin
          // moves, and a page must not be marked done without its new titles.
          const [org] = (await tx.execute(sql`
            SELECT embedding_model_in_use AS pinned,
              (embedding_migration_lease_until IS NOT NULL AND embedding_migration_lease_until > now()) AS leased
            FROM orgs WHERE id = ${orgId} FOR SHARE
          `)) as unknown as { pinned: string | null; leased: boolean }[]
          if (!org || org.pinned !== pinned || org.leased) throw new MigrationStartedError(orgId)
          let count = 0
          for (let i = 0; i < changes.length; i++) {
            const c = changes[i]
            const before = contentHash(c.question, c.answer)
            const after = contentHash(c.next, c.answer)
            const vector = JSON.stringify(embeddings[i])
            const updated = (await tx.execute(sql`
              UPDATE kb_articles
              SET question = ${c.next}, embedding = ${vector}, embedding_vec = ${vector}::vector, updated_at = ${now},
                  verified_content_hash = CASE WHEN verified_content_hash = ${before} THEN ${after} ELSE verified_content_hash END
              WHERE id = ${c.id} AND org_id = ${orgId} AND question = ${c.question} AND answer = ${c.answer} AND model = ${pinned}
              RETURNING id
            `)) as unknown as { id: number }[]
            if (updated.length === 0) continue
            await recordArticleEvent(tx, { orgId, articleId: c.id, type: 'edited', origin: 'import', contentHash: after })
            count++
          }
          await tx.execute(sql`UPDATE kb_sources SET titles_version = 1 WHERE id = ${source.id} AND org_id = ${orgId}`)
          return count
        })
      } catch (err) {
        if (!(err instanceof MigrationStartedError)) throw err
        // Not a failure: the pages left are picked up once the switch is done.
        ok = true
        return { retitled, sourcesDone, remainingSources: await countRemaining(orgId), skipped: 'migrating' }
      }
      retitled += written
      sourcesDone++
    }

    const remainingSources = await countRemaining(orgId)
    logger.info('re-title pass', { module: MOD, orgId, mode: opts.mode, retitled, sourcesDone, remainingSources })
    ok = true
    return { retitled, sourcesDone, remainingSources }
  } finally {
    await releaseLease(orgId, lease, ok)
  }
}
