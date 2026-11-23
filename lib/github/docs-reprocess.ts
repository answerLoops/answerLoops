import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { enqueueKbSyncJob } from '@/lib/db/queries/kb-sync-jobs'
import { DOCS_PROCESSING_VERSION } from '@/lib/ingest/docs-file'
import { isFreeReprocessCandidate } from '@/lib/kb/pass-embedder'
import { logger } from '@/lib/logger'

/**
 * Brings synced repository docs up to the current cleanup rules once, in the
 * background: repos whose docs were synced before each file was recorded, or
 * under an older DOCS_PROCESSING_VERSION, get one sync queued. Only for
 * workspaces where re-processing runs on our key at no cost to them
 * (lib/kb/pass-embedder.ts); everyone else re-processes on their next push or
 * Sync now, on their own key. The sync itself does the work
 * (lib/github/kb-sync.ts).
 */

const MOD = 'github/docs-reprocess'
/** Between attempts for one repo, so a repo that keeps failing isn't queued every sweep. */
const REPROCESS_COOLDOWN_MS = 60 * 60 * 1000

export async function listReprocessRepos(limit = 50): Promise<{ orgId: number; repoId: number }[]> {
  const rows = (await getDb().execute(sql`
    SELECT r.org_id, r.id AS repo_id
    FROM github_repos r
    JOIN kb_sources s ON s.org_id = r.org_id AND s.filename = r.owner || '/' || r.repo
    WHERE r.kb_enabled = 1
      AND EXISTS (SELECT 1 FROM kb_articles a WHERE a.source_id = s.id AND a.org_id = r.org_id)
      AND (
        NOT EXISTS (SELECT 1 FROM kb_source_files f WHERE f.source_id = s.id)
        OR EXISTS (SELECT 1 FROM kb_source_files f WHERE f.source_id = s.id AND f.processing_version < ${DOCS_PROCESSING_VERSION})
      )
      AND NOT EXISTS (
        SELECT 1 FROM kb_sync_jobs j
        WHERE j.org_id = r.org_id AND j.kind = 'github_repo' AND j.repo_id = r.id AND j.status IN ('queued', 'running')
      )
      -- At most one attempt a day, so a repo that can't be finished yet (a
      -- full knowledge base, a file that won't fit) isn't queued every hour.
      AND NOT EXISTS (
        SELECT 1 FROM kb_sync_jobs j
        WHERE j.org_id = r.org_id AND j.kind = 'github_repo' AND j.repo_id = r.id
          AND j.reprocess_only AND j.created_at::timestamptz > now() - interval '24 hours'
      )
    ORDER BY r.id
    LIMIT ${limit}
  `)) as unknown as { org_id: number; repo_id: number }[]
  return rows.map((r) => ({ orgId: r.org_id, repoId: r.repo_id }))
}

/** Re-processing jobs allowed to wait at once, so they never build a backlog. */
const MAX_WAITING = 5

/**
 * Queues one re-processing job per eligible repo, keeping at most
 * MAX_WAITING of them waiting. They are claimed after syncs a person or a push
 * queued. Returns how many new jobs were queued.
 */
export async function enqueueDocsReprocess(): Promise<{ queued: number }> {
  const waiting = (await getDb().execute(sql`
    SELECT count(*)::int AS n FROM kb_sync_jobs WHERE status = 'queued' AND reprocess_only
  `)) as unknown as { n: number }[]
  const room = MAX_WAITING - Number(waiting[0]?.n ?? 0)
  if (room <= 0) return { queued: 0 }

  const repos = await listReprocessRepos()
  const freeByOrg = new Map<number, boolean>()
  let queued = 0
  for (const { orgId, repoId } of repos) {
    if (queued >= room) break
    try {
      if (!freeByOrg.has(orgId)) freeByOrg.set(orgId, await isFreeReprocessCandidate(orgId))
      if (!freeByOrg.get(orgId)) continue
      const job = await enqueueKbSyncJob({ orgId, kind: 'github_repo', repoId, cooldownMs: REPROCESS_COOLDOWN_MS, reprocessOnly: true })
      if (job.created) queued++
    } catch (err) {
      // One workspace failing must not block the rest; the next sweep retries it.
      logger.error('could not queue docs re-processing', { module: MOD, orgId, repoId, error: err })
    }
  }
  if (queued > 0) logger.info('queued docs re-processing', { module: MOD, queued })
  return { queued }
}
