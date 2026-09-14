import { sql } from 'drizzle-orm'
import { getDb } from '../drizzle'

export type KbSyncJobKind = 'notion' | 'github_repo'
export type KbSyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface KbSyncJob {
  id: number
  org_id: number
  kind: KbSyncJobKind
  repo_id: number | null
  status: KbSyncJobStatus
  detail: string | null
  synced_count: number
  progress: number
  total: number
  current_item: string | null
  attempts: number
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/**
 * Enqueue a sync for a source, or return the job already in flight for it.
 * The `kb_sync_jobs_one_active` partial unique index makes the INSERT a no-op
 * when a queued-or-running job already exists for this (kind, repo_id) — so a
 * double-click, or GitHub retrying a push delivery, never starts a second
 * concurrent sync of the same source.
 */
export async function enqueueKbSyncJob(input: {
  orgId: number
  kind: KbSyncJobKind
  repoId?: number | null
}): Promise<{ id: number; status: KbSyncJobStatus; created: boolean }> {
  const repoId = input.repoId ?? null
  const inserted = (await getDb().execute(sql`
    INSERT INTO kb_sync_jobs (org_id, kind, repo_id)
    VALUES (${input.orgId}, ${input.kind}, ${repoId})
    ON CONFLICT DO NOTHING
    RETURNING id, status
  `)) as unknown as { id: number; status: KbSyncJobStatus }[]

  if (inserted[0]) return { id: inserted[0].id, status: inserted[0].status, created: true }

  const existing = (await getDb().execute(sql`
    SELECT id, status FROM kb_sync_jobs
    WHERE kind = ${input.kind}
      AND COALESCE(repo_id, 0) = COALESCE(${repoId}, 0)
      AND status IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `)) as unknown as { id: number; status: KbSyncJobStatus }[]

  if (existing[0]) return { id: existing[0].id, status: existing[0].status, created: false }

  // The active job finished between our INSERT and this SELECT — retry once.
  const retry = (await getDb().execute(sql`
    INSERT INTO kb_sync_jobs (org_id, kind, repo_id)
    VALUES (${input.orgId}, ${input.kind}, ${repoId})
    ON CONFLICT DO NOTHING
    RETURNING id, status
  `)) as unknown as { id: number; status: KbSyncJobStatus }[]
  if (retry[0]) return { id: retry[0].id, status: retry[0].status, created: true }

  const again = (await getDb().execute(sql`
    SELECT id, status FROM kb_sync_jobs
    WHERE kind = ${input.kind} AND COALESCE(repo_id, 0) = COALESCE(${repoId}, 0)
      AND status IN ('queued', 'running')
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as { id: number; status: KbSyncJobStatus }[]
  return { id: again[0]?.id ?? 0, status: again[0]?.status ?? 'running', created: false }
}

/**
 * Atomically claim the oldest queued job: flip it to `running`, bump attempts,
 * stamp started_at. `FOR UPDATE SKIP LOCKED` lets several sweep ticks (or a
 * future second worker) run without handing the same job to two of them.
 */
export async function claimNextKbSyncJob(): Promise<KbSyncJob | null> {
  const rows = (await getDb().execute(sql`
    UPDATE kb_sync_jobs SET
      status = 'running',
      started_at = now(),
      attempts = attempts + 1
    WHERE id = (
      SELECT id FROM kb_sync_jobs
      WHERE status = 'queued'
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `)) as unknown as KbSyncJob[]
  return rows[0] ?? null
}

export async function getKbSyncJob(id: number): Promise<KbSyncJob | null> {
  const rows = (await getDb().execute(sql`
    SELECT * FROM kb_sync_jobs WHERE id = ${id} LIMIT 1
  `)) as unknown as KbSyncJob[]
  return rows[0] ?? null
}

/**
 * Update a running job's progress counters. Cheap and best-effort — the run
 * route throttles calls, and a lost update just means the KB page's number
 * lags by a beat. Scoped to `status = 'running'` so a late write can't
 * resurrect a reclaimed or finished job.
 */
export async function updateKbSyncJobProgress(
  id: number,
  progress: number,
  total: number,
  currentItem?: string | null,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE kb_sync_jobs SET progress = ${progress}, total = ${total}, current_item = ${currentItem ?? null}
    WHERE id = ${id} AND status = 'running'
  `)
}

export async function finishKbSyncJob(
  id: number,
  input: { status: 'succeeded' | 'failed'; detail?: string | null; syncedCount?: number },
): Promise<void> {
  await getDb().execute(sql`
    UPDATE kb_sync_jobs SET
      status = ${input.status},
      detail = ${input.detail ?? null},
      synced_count = ${input.syncedCount ?? 0},
      finished_at = now()
    WHERE id = ${id}
  `)
}

/**
 * Recover jobs stranded in `running` — the worker crashed, the request timed
 * out, the bot was redeployed mid-sync. Back to `queued` for another attempt,
 * or `failed` once it has burned through `maxAttempts`.
 */
export async function reclaimStuckKbSyncJobs(thresholdMs: number, maxAttempts: number): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMs).toISOString()
  const rows = (await getDb().execute(sql`
    UPDATE kb_sync_jobs SET
      status = CASE WHEN attempts >= ${maxAttempts} THEN 'failed' ELSE 'queued' END,
      detail = CASE WHEN attempts >= ${maxAttempts}
                    THEN 'Sync did not finish after repeated attempts' ELSE detail END,
      finished_at = CASE WHEN attempts >= ${maxAttempts} THEN now() ELSE finished_at END
    WHERE status = 'running' AND started_at < ${cutoff}
    RETURNING id
  `)) as unknown as { id: number }[]
  return rows.length
}

/** Latest job for a source — powers the KB page's status poll. */
export async function getLatestKbSyncJob(
  orgId: number,
  kind: KbSyncJobKind,
  repoId?: number | null,
): Promise<KbSyncJob | null> {
  const rows = (await getDb().execute(sql`
    SELECT * FROM kb_sync_jobs
    WHERE org_id = ${orgId} AND kind = ${kind}
      AND COALESCE(repo_id, 0) = COALESCE(${repoId ?? null}, 0)
    ORDER BY created_at DESC
    LIMIT 1
  `)) as unknown as KbSyncJob[]
  return rows[0] ?? null
}
