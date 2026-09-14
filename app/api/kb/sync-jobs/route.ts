import { type NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getLatestKbSyncJob, type KbSyncJobKind } from '@/lib/db/queries/kb-sync-jobs'

export const dynamic = 'force-dynamic'

// Latest KB sync job for a source — the KB page polls this while a sync is
// queued or running.
export async function GET(req: NextRequest) {
  const access = await requireOrgAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 401 })

  const kind = req.nextUrl.searchParams.get('kind')
  if (kind !== 'notion' && kind !== 'github_repo') {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
  }
  const repoIdParam = req.nextUrl.searchParams.get('repo_id')
  const repoId = repoIdParam ? Number(repoIdParam) : null
  if (kind === 'github_repo' && !repoId) {
    return NextResponse.json({ error: 'Missing repo_id' }, { status: 400 })
  }

  const job = await getLatestKbSyncJob(access.orgId, kind as KbSyncJobKind, repoId)
  if (!job) return NextResponse.json(null)

  return NextResponse.json({
    status: job.status,
    detail: job.detail,
    syncedCount: job.synced_count,
    progress: job.progress,
    total: job.total,
    currentItem: job.current_item,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
  })
}
