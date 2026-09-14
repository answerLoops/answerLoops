'use client'

// Client-side helpers for enqueuing and polling a KB sync job. Shared between
// the Knowledge Base page and any settings card that offers its own "Sync
// now" button, so both stay wired to the same queue-based sync contract
// instead of drifting (the Notion settings card used to assume the old
// synchronous { synced, truncated } response shape and call the enqueue
// route with GET, both stale since sync moved to a background job).

export interface KbSyncJobStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  detail: string | null
  syncedCount: number
  progress: number
  total: number
  currentItem: string | null
}

function truncateTitle(title: string, max = 40): string {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title
}

export interface KbSyncResult {
  ok: boolean
  detail: string
  syncedCount: number
}

// Poll a queued/running KB sync job to completion. `statusQuery` is the full
// /api/kb/sync-jobs?... URL for the source. `onLabel` updates the button
// text. `isCancelled`, checked before every fetch and before every scheduled
// retry, lets a caller stop the loop early — the poll otherwise runs
// unconditionally until the job reaches a terminal status or the 15-minute
// timeout, with no way to abort it from outside (an unmounted component, or
// a source the user just disconnected, would poll forever without this).
export function pollKbSyncJob(
  statusQuery: string,
  onLabel: (label: string) => void,
  isCancelled?: () => boolean,
): Promise<KbSyncResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const scheduleRetry = () => {
      if (isCancelled?.()) {
        resolve({ ok: false, detail: 'Sync polling stopped.', syncedCount: 0 })
        return
      }
      setTimeout(tick, 2500)
    }
    const tick = async () => {
      if (isCancelled?.()) {
        resolve({ ok: false, detail: 'Sync polling stopped.', syncedCount: 0 })
        return
      }
      if (Date.now() - startedAt > 15 * 60 * 1000) {
        resolve({ ok: false, detail: 'Sync is taking longer than expected — check back shortly.', syncedCount: 0 })
        return
      }
      let job: KbSyncJobStatus | null = null
      try {
        job = await fetch(statusQuery).then((r) => (r.ok ? r.json() : null))
      } catch {
        scheduleRetry()
        return
      }
      if (!job || job.status === 'queued') {
        onLabel('Queued…')
        scheduleRetry()
      } else if (job.status === 'running') {
        const count = job.total > 0 ? ` (${Math.min(job.progress, job.total)}/${job.total})` : ''
        onLabel(job.currentItem ? `Syncing: ${truncateTitle(job.currentItem)}${count}` : `Syncing…${count}`)
        scheduleRetry()
      } else if (job.status === 'succeeded') {
        resolve({ ok: true, detail: job.detail ?? 'Sync complete', syncedCount: job.syncedCount ?? 0 })
      } else {
        resolve({ ok: false, detail: job.detail ?? 'Sync failed', syncedCount: 0 })
      }
    }
    tick()
  })
}

// Enqueue a sync and poll it to completion.
export async function runKbSync(
  enqueueUrl: string,
  statusQuery: string,
  onLabel: (label: string) => void,
  isCancelled?: () => boolean,
): Promise<KbSyncResult> {
  let res: Response
  try {
    res = await fetch(enqueueUrl, { method: 'POST' })
  } catch {
    return { ok: false, detail: 'Could not reach the server.', syncedCount: 0 }
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, detail: body.error ?? 'Could not queue the sync.', syncedCount: 0 }
  }
  onLabel('Queued…')
  return pollKbSyncJob(statusQuery, onLabel, isCancelled)
}
