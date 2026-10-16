import { type NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getRepoById } from '@/lib/db/queries/github'
import { enqueueKbSyncJob } from '@/lib/db/queries/kb-sync-jobs'
import { logger } from '@/lib/logger'

const MOD = 'api/github/sync-kb'

// Queues a background sync for one repo and returns immediately — the markdown
// and discussion sync work runs in the bot-driven job, off the request path
// (see app/api/kb/sync-jobs/run/route.ts).
export async function POST(req: NextRequest) {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })

  const repoId = Number(req.nextUrl.searchParams.get('repo_id'))
  if (!repoId) return NextResponse.json({ error: 'Missing repo_id' }, { status: 400 })

  const repo = await getRepoById(repoId, access.orgId)
  if (!repo) return NextResponse.json({ error: 'Repo not found' }, { status: 404 })

  try {
    const job = await enqueueKbSyncJob({ orgId: access.orgId, kind: 'github_repo', repoId: repo.id, pullForward: true })
    return NextResponse.json({ jobId: job.id, status: job.status, alreadyQueued: !job.created })
  } catch (err) {
    logger.error('failed to enqueue github kb sync', { module: MOD, orgId: access.orgId, repoId, error: err })
    return NextResponse.json({ error: 'Could not queue the sync' }, { status: 500 })
  }
}
