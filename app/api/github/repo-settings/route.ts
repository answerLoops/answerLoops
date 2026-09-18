import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { updateRepoSettings } from '@/lib/db/queries/github'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/github/repo-settings'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = (session as { orgId?: number }).orgId ?? DEFAULT_ORG_ID

  let body: { repoId?: number; monitoredEvents?: string; kbEnabled?: number; autoDeflectEnabled?: number }
  try {
    body = await req.json()
  } catch (err) {
    logger.error('repo settings update — invalid JSON body', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.repoId) return NextResponse.json({ error: 'Missing repoId' }, { status: 400 })

  const validEvents = ['issues', 'discussions', 'both', 'none']
  if (body.monitoredEvents && !validEvents.includes(body.monitoredEvents)) {
    return NextResponse.json({ error: 'Invalid monitoredEvents' }, { status: 400 })
  }

  try {
    await updateRepoSettings(body.repoId, orgId, {
      ...(body.monitoredEvents !== undefined && { monitoredEvents: body.monitoredEvents }),
      ...(body.kbEnabled !== undefined && { kbEnabled: body.kbEnabled }),
      ...(body.autoDeflectEnabled !== undefined && { autoDeflectEnabled: body.autoDeflectEnabled }),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error('repo settings update failed', { module: MOD, requestId: getRequestId(req), orgId, repoId: body.repoId, error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
