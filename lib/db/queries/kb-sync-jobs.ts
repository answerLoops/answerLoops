import { sql } from 'drizzle-orm'
import { getDb } from '../drizzle'

export type KbSyncJobKind = 'notion' | 'github_repo'
type KbSyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

interface KbSyncJob {
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
  heartbeat_at: string | null
  not_before: string | null
  rerun_requested: boolean
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/**
 * Enqueue a sync for a source, or return the job already in flight for it.
 * The `kb_sync_jobs_one_active` partial unique index makes the INSERT a no-op
 * when a queued-or-running job already exists for this (org, kind, repo) — so a
 * double-click, or GitHub retrying a push delivery, never starts a second
 * concurrent sync of the same source.
 *
 * `cooldownMs` delays a new job until that long after the source's previous
 * run finished, so a stream of triggers does not re-embed back to back.
 * `rerunIfRunning` records a trigger that lands while a run is in progress:
 * finishing that run queues exactly one follow-up, so the latest content is
 * still picked up.
 * `pullForward` is for a person pressing "Sync now": a queued job that is
 * still waiting out a cooldown is made due immediately (and the bot is
 * notified) instead of leaving the click to sit until the cooldown ends. It
 * never creates a second active job and never affects the cooldown applied to
 * webhook-driven enqueues.
 */
export async function enqueueKbSyncJob(input: {
  orgId: number
  kind: KbSyncJobKind
  repoId?: number | null
  cooldownMs?: number
  rerunIfRunning?: boolean
  pullForward?: boolean
}): Promise<{ id: number; status: KbSyncJobStatus; created: boolean }> {
  const repoId = input.repoId ?? null
  const db = getDb()

  let notBefore: string | null = null
  if (input.cooldownMs && input.cooldownMs > 0) {
    const last = (await db.execute(sql`
      SELECT finished_at::timestamptz AS finished_at FROM kb_sync_jobs
      WHERE org_id = ${input.orgId} AND kind = ${input.kind}
        AND COALESCE(repo_id, 0) = COALESCE(${repoId}, 0)
        AND finished_at IS NOT NULL
      ORDER BY finished_at::timestamptz DESC
      LIMIT 1
    `)) as unknown as { finished_at: string | Date | null }[]
    const finishedAt = last[0]?.finished_at ? new Date(last[0].finished_at).getTime() : null
    if (finishedAt !== null && Number.isFinite(finishedAt)) {
      const due = finishedAt + input.cooldownMs
      if (due > Date.now()) notBefore = new Date(due).toISOString()
    }
  }

  // The active job can finish between the INSERT and the lookup (or start
  // between the lookup and a retry), so the pair is attempted a few times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = (await db.execute(sql`
      INSERT INTO kb_sync_jobs (org_id, kind, repo_id, not_before)
      VALUES (${input.orgId}, ${input.kind}, ${repoId}, ${notBefore}::timestamptz)
      ON CONFLICT DO NOTHING
      RETURNING id, status
    `)) as unknown as { id: number; status: KbSyncJobStatus }[]
    if (inserted[0]) return { id: inserted[0].id, status: inserted[0].status, created: true }

    const existing = (await db.execute(sql`
      SELECT id, status FROM kb_sync_jobs
      WHERE org_id = ${input.orgId}
        AND kind = ${input.kind}
        AND COALESCE(repo_id, 0) = COALESCE(${repoId}, 0)
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `)) as unknown as { id: number; status: KbSyncJobStatus }[]
    const active = existing[0]
    if (!active) continue

    if (active.status === 'running' && input.rerunIfRunning) {
      const marked = (await db.execute(sql`
        UPDATE kb_sync_jobs SET rerun_requested = true
        WHERE id = ${active.id} AND org_id = ${input.orgId} AND status = 'running'
        RETURNING id
      `)) as unknown as { id: number }[]
      // Finished while we were marking it — go round again and insert.
      if (marked.length === 0) continue
    }
    if (active.status === 'queued' && input.pullForward) {
      const pulled = (await db.execute(sql`
        UPDATE kb_sync_jobs SET not_before = now()
        WHERE id = ${active.id} AND org_id = ${input.orgId}
          AND status = 'queued' AND not_before IS NOT NULL AND not_before > now()
        RETURNING id
      `)) as unknown as { id: number }[]
      // The trigger only fires when a row becomes queued, so waking the worker
      // for a job that was already queued is done here, on the same channel.
      if (pulled[0]) await db.execute(sql`SELECT pg_notify('kb_sync_job_queued', ${String(active.id)})`)
    }
    return { id: active.id, status: active.status, created: false }
  }
  return { id: 0, status: 'running', created: false }
}

/**
 * Atomically claim the oldest queued job that is due: flip it to `running`,
 * bump attempts, stamp started_at and the first heartbeat. `FOR UPDATE SKIP
 * LOCKED` lets several sweep ticks (or a future second worker) run without
 * handing the same job to two of them. The returned `attempts` identifies this
 * claim: every later write for the job is conditional on it.
 */
export async function claimNextKbSyncJob(): Promise<KbSyncJob | null> {
  const rows = (await getDb().execute(sql`
    UPDATE kb_sync_jobs SET
      status = 'running',
      started_at = now(),
      heartbeat_at = now(),
      attempts = attempts + 1
    WHERE id = (
      SELECT id FROM kb_sync_jobs
      WHERE status = 'queued' AND (not_before IS NULL OR not_before <= now())
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
 * Update a running job's progress counters and heartbeat. Scoped to
 * `status = 'running'` and to the claimed attempt, so a late write from a
 * worker whose job was reclaimed or finished cannot touch the row. Returns
 * false when no row matched — the caller no longer owns the job and should
 * stop.
 */
export async function updateKbSyncJobProgress(
  id: number,
  attempt: number,
  progress: number,
  total: number,
  currentItem?: string | null,
): Promise<boolean> {
  const rows = (await getDb().execute(sql`
    UPDATE kb_sync_jobs SET
      progress = ${progress},
      total = ${total},
      current_item = ${currentItem ?? null},
      heartbeat_at = now()
    WHERE id = ${id} AND status = 'running' AND attempts = ${attempt}
    RETURNING id
  `)) as unknown as { id: number }[]
  return rows.length > 0
}

/**
 * Keep a running job's lease alive between progress writes (a single slow
 * page or file can outlast the reclaim window). Returns false when the caller
 * no longer owns the job.
 */
export async function heartbeatKbSyncJob(id: number, attempt: number): Promise<boolean> {
  const rows = (await getDb().execute(sql`
    UPDATE kb_sync_jobs SET heartbeat_at = now()
    WHERE id = ${id} AND status = 'running' AND attempts = ${attempt}
    RETURNING id
  `)) as unknown as { id: number }[]
  return rows.length > 0
}

/**
 * Record the outcome of a claimed job. Conditional on the job still being
 * `running` at this attempt, so a worker that lost its lease cannot overwrite
 * a reclaimed or newer run; returns false in that case. If another trigger
 * arrived during the run (`rerun_requested`), one follow-up job is queued,
 * delayed by `followUpDelayMs`, in the same transaction.
 */
export async function finishKbSyncJob(
  id: number,
  attempt: number,
  input: { status: 'succeeded' | 'failed'; detail?: string | null; syncedCount?: number },
  followUpDelayMs = 0,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const done = (await tx.execute(sql`
      UPDATE kb_sync_jobs SET
        status = ${input.status},
        detail = ${input.detail ?? null},
        synced_count = ${input.syncedCount ?? 0},
        finished_at = now()
      WHERE id = ${id} AND status = 'running' AND attempts = ${attempt}
      RETURNING org_id, kind, repo_id, rerun_requested
    `)) as unknown as { org_id: number; kind: KbSyncJobKind; repo_id: number | null; rerun_requested: boolean }[]
    const row = done[0]
    if (!row) return false
    if (row.rerun_requested) {
      const notBefore = new Date(Date.now() + Math.max(0, followUpDelayMs)).toISOString()
      await tx.execute(sql`
        INSERT INTO kb_sync_jobs (org_id, kind, repo_id, not_before)
        VALUES (${row.org_id}, ${row.kind}, ${row.repo_id}, ${notBefore}::timestamptz)
        ON CONFLICT DO NOTHING
      `)
    }
    return true
  })
}

/**
 * Recover jobs stranded in `running` — judged by the last heartbeat, not the
 * start time, so a long sync that is still reporting is left alone. The worker crashed, the request timed
 * out, the bot was redeployed mid-sync. Back to `queued` for another attempt,
 * or `failed` once it has burned through `maxAttempts`.
 */
export async function reclaimStuckKbSyncJobs(thresholdMs: number, maxAttempts: number): Promise<number> {
  const rows = (await getDb().execute(sql`
    UPDATE kb_sync_jobs SET
      status = CASE WHEN attempts >= ${maxAttempts} THEN 'failed' ELSE 'queued' END,
      detail = CASE WHEN attempts >= ${maxAttempts}
                    THEN 'Sync did not finish after repeated attempts' ELSE detail END,
      finished_at = CASE WHEN attempts >= ${maxAttempts} THEN now()::text ELSE finished_at END
    WHERE status = 'running'
      AND COALESCE(heartbeat_at, started_at::timestamptz) < now() - (${thresholdMs}::double precision * interval '1 millisecond')
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
