import { z } from 'zod'
import {
  getKbSyncJob,
  finishKbSyncJob,
  updateKbSyncJobProgress,
} from '@/lib/db/queries/kb-sync-jobs'
import { throttleProgress } from '@/lib/kb-sync/progress'
import { getRepoById } from '@/lib/db/queries/github'
import { syncNotionToKB } from '@/lib/notion/kb-sync'
import { syncRepoToKB, syncDiscussionsToKB } from '@/lib/github/kb-sync'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MOD = 'api/kb/sync-jobs/run'

const RunSchema = z.object({ jobId: z.number() })

// Called only by the bot process's KB-sync sweep (bot/index.ts) — never by a
// webhook or a browser. Authenticated with the platform-wide BOT_SECRET, the
// same pattern as app/api/ingest/retry-stuck. The sweep has already claimed
// the job (status → running) before it POSTs here; this route does the work
// awaited and records the outcome.
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!bearer || !process.env.BOT_SECRET || bearer !== process.env.BOT_SECRET) {
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

  // Progress writes are best-effort and throttled — a lost one just lags the
  // KB page's number by a beat. `void` the promise so a slow write never
  // stalls the sync loop.
  const jobId = job.id
  const progress = throttleProgress((done, total, item) => {
    void updateKbSyncJobProgress(jobId, done, total, item)
  })

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
      if (!repo) throw new Error('repo not found')
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

    await finishKbSyncJob(job.id, { status: 'succeeded', detail, syncedCount })
    logger.info('kb sync job done', { module: MOD, jobId: job.id, kind: job.kind, syncedCount })
    return Response.json({ ok: true, ran: true, syncedCount })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    await finishKbSyncJob(job.id, { status: 'failed', detail: message })
    logger.error('kb sync job failed', { module: MOD, jobId: job.id, kind: job.kind, error: err })
    // 200 on purpose — the job is recorded as failed; a 500 would just make
    // the bot retry this POST for a job that is already terminal.
    return Response.json({ ok: true, ran: true, failed: true })
  }
}
