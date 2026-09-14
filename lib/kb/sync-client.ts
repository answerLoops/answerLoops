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
}

export interface KbSyncResult {
  ok: boolean
  detail: string
  syncedCount: number
}

// Poll a queued/running KB sync job to completion. `statusQuery` is the full
// /api/kb/sync-jobs?... URL for the source. `onLabel` updates the button text.
export function pollKbSyncJob(statusQuery: string, onLabel: (label: string) => void): Promise<KbSyncResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const tick = async () => {
      if (Date.now() - startedAt > 15 * 60 * 1000) {
        resolve({ ok: false, detail: 'Sync is taking longer than expected — check back shortly.', syncedCount: 0 })
        return
      }
      let job: KbSyncJobStatus | null = null
      try {
        job = await fetch(statusQuery).then((r) => (r.ok ? r.json() : null))
      } catch {
        setTimeout(tick, 2500)
        return
      }
      if (!job || job.status === 'queued') {
        onLabel('Queued…')
        setTimeout(tick, 2500)
      } else if (job.status === 'running') {
        onLabel(job.total > 0 ? `Syncing ${Math.min(job.progress, job.total)}/${job.total}` : 'Syncing…')
        setTimeout(tick, 2500)
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
  return pollKbSyncJob(statusQuery, onLabel)
}
