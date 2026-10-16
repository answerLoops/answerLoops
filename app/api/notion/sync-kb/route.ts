import { NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { enqueueKbSyncJob } from '@/lib/db/queries/kb-sync-jobs'
import { logger } from '@/lib/logger'

const MOD = 'api/notion/sync-kb'

// Queues a background sync and returns immediately. The bot process picks the
// job up and drives it via POST /api/kb/sync-jobs/run — the sync itself no
// longer runs inside this request, which used to time out on any non-trivial
// workspace.
export async function POST() {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })

  try {
    const job = await enqueueKbSyncJob({ orgId: access.orgId, kind: 'notion', pullForward: true })
    return NextResponse.json({ jobId: job.id, status: job.status, alreadyQueued: !job.created })
  } catch (err) {
    logger.error('failed to enqueue notion kb sync', { module: MOD, orgId: access.orgId, error: err })
    return NextResponse.json({ error: 'Could not queue the sync' }, { status: 500 })
  }
}
