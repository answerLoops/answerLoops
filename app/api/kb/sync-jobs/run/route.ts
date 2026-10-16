import { z } from 'zod'
import {
  getKbSyncJob,
  finishKbSyncJob,
  heartbeatKbSyncJob,
  updateKbSyncJobProgress,
} from '@/lib/db/queries/kb-sync-jobs'
import { KbSyncUserError, KbSyncLeaseLostError, KB_SYNC_GENERIC_FAILURE } from '@/lib/kb-sync/errors'
import { throttleProgress } from '@/lib/kb-sync/progress'
import { getRepoById } from '@/lib/db/queries/github'
import { syncNotionToKB } from '@/lib/notion/kb-sync'
import { syncRepoToKB, syncDiscussionsToKB } from '@/lib/github/kb-sync'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { aiUnavailableMessage } from '@/lib/ai/errors'
import { isPlatformBotRequest } from '@/lib/http/bearer-auth'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MOD = 'api/kb/sync-jobs/run'

// How often a running job refreshes its heartbeat between progress writes. Well
// inside the sweep's reclaim window, so a slow page or file never looks stale.
const HEARTBEAT_INTERVAL_MS = 30_000

// Wait before the follow-up run a trigger-during-run asks for.
const FOLLOW_UP_DELAY_MS = 2 * 60 * 1000

const RunSchema = z.object({ jobId: z.number() })

// Called only by the bot process's KB-sync sweep (bot/index.ts) — never by a
// webhook or a browser. Authenticated with the platform-wide BOT_SECRET, the
// same pattern as app/api/ingest/retry-stuck. The sweep has already claimed
// the job (status → running) before it POSTs here; this route does the work
// awaited and records the outcome.
export async function POST(request: Request) {
  if (!isPlatformBotRequest(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = RunSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 })

  const job = await getKbSyncJob(parsed.data.jobId)
  if (!job) return Response.json({ ok: true, ran: false, reason: 'not found' })
  if (job.status !== 'running') {
    // Reclaimed, already finished, or claimed by another worker — nothing to do.
    return Response.json({ ok: true, ran: false, reason: job.status })
  }

  // The attempt number identifies this worker's claim. Every write below is
  // conditional on it, so a worker whose job was reclaimed cannot overwrite
  // the newer run.
  const jobId = job.id
  const attempt = job.attempts

  // Progress writes are throttled and not awaited, so a slow write never
  // stalls the sync loop. A write that matches no row means the lease is gone;
  // the next progress call from the sync throws and the sync unwinds.
  let leaseLost = false
  const noteWrite = (p: Promise<boolean>) => {
    p.then((owned) => { if (!owned) leaseLost = true }).catch((err) => {
      logger.warn('kb sync progress write failed', { module: MOD, jobId, error: err })
    })
  }
  const throttled = throttleProgress((done, total, item) => {
    noteWrite(updateKbSyncJobProgress(jobId, attempt, done, total, item))
  })
  const progress = (done: number, total: number, item?: string) => {
    if (leaseLost) throw new KbSyncLeaseLostError(jobId)
    throttled(done, total, item)
  }
  const heartbeat = setInterval(() => noteWrite(heartbeatKbSyncJob(jobId, attempt)), HEARTBEAT_INTERVAL_MS)

  try {
    let syncedCount = 0
    let detail = ''

    if (job.kind === 'notion') {
      const res = await syncNotionToKB(job.org_id, { onProgress: progress })
      syncedCount = res.synced
      const notes: string[] = []
      if (res.truncated) notes.push('the knowledge-base article cap was hit')
      if (res.pagesCapped) notes.push('the page limit was hit')
      if (res.databasesCapped) notes.push('the database limit was hit')
      detail = notes.length
        ? `Synced ${res.synced} chunks from Notion — ${notes.join(' and ')}, some content was skipped`
        : `Synced ${res.synced} chunks from Notion`
    } else if (job.kind === 'github_repo') {
      if (!job.repo_id) throw new Error('github_repo job has no repo_id')
      const repo = await getRepoById(job.repo_id, job.org_id)
      if (!repo) throw new KbSyncUserError('That repository is no longer connected — reconnect it and sync again.')
      // Sequential: both paths read-modify-write the repo's kbChunkCount.
      // Discussion progress is offset past the repo-files total so the KB
      // page's bar keeps climbing across the two phases.
      let filesTotal = 0
      const docs = await syncRepoToKB(repo.id, repo.owner, repo.repo, repo.installation_id, job.org_id, {
        onProgress: (d, t) => { filesTotal = t; progress(d, t) },
      })
      const discussions = await syncDiscussionsToKB(repo.id, repo.owner, repo.repo, repo.installation_id, job.org_id, {
        onProgress: (d, t) => progress(filesTotal + d, filesTotal + t),
      })
      syncedCount = docs + discussions
      detail = `Synced ${docs} doc chunk${docs === 1 ? '' : 's'} and ${discussions} discussion chunk${discussions === 1 ? '' : 's'}`
    } else {
      throw new Error(`unknown kb sync job kind: ${job.kind}`)
    }

    if (leaseLost) throw new KbSyncLeaseLostError(jobId)
    const recorded = await finishKbSyncJob(jobId, attempt, { status: 'succeeded', detail, syncedCount }, FOLLOW_UP_DELAY_MS)
    if (!recorded) {
      logger.warn('kb sync job result discarded — job no longer owned', { module: MOD, jobId, kind: job.kind })
      return Response.json({ ok: true, ran: true, superseded: true })
    }
    logger.info('kb sync job done', { module: MOD, jobId, kind: job.kind, syncedCount })
    return Response.json({ ok: true, ran: true, syncedCount })
  } catch (err) {
    if (err instanceof KbSyncLeaseLostError) {
      // Another worker owns the job now; it records the outcome.
      logger.warn('kb sync stopped — job no longer owned', { module: MOD, jobId, kind: job.kind })
      return Response.json({ ok: true, ran: true, superseded: true })
    }
    // The real error stays in the server log; the job row only ever holds
    // text written for the workspace owner.
    const message = userFacingFailure(err)
    await finishKbSyncJob(jobId, attempt, { status: 'failed', detail: message }, FOLLOW_UP_DELAY_MS)
    logger.error('kb sync job failed', { module: MOD, jobId, kind: job.kind, error: err })
    // 200 on purpose — the job is recorded as failed; a 500 would just make
    // the bot retry this POST for a job that is already terminal.
    return Response.json({ ok: true, ran: true, failed: true })
  } finally {
    clearInterval(heartbeat)
  }
}

function userFacingFailure(err: unknown): string {
  if (err instanceof NoAIProviderConfiguredError) {
    return aiUnavailableMessage(err, 'No AI provider is set up for this workspace — add one in Settings → AI Model, then sync again.')
  }
  if (err instanceof KbSyncUserError) return err.message
  return KB_SYNC_GENERIC_FAILURE
}
