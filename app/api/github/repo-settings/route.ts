import { type NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { updateRepoSettings } from '@/lib/db/queries/github'
import { normalizeDocPaths } from '@/lib/github/doc-folders'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/github/repo-settings'

export async function POST(req: NextRequest) {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })
  const orgId = access.orgId

  let body: { repoId?: number; monitoredEvents?: string; kbEnabled?: number; autoDeflectEnabled?: number; kbPaths?: unknown }
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

  // Folders come from the picker, which only offers folders in the repo; this
  // still refuses anything empty or path-like that could leave the repo.
  let kbPaths: string[] | undefined
  if (body.kbPaths !== undefined) {
    const normalized = normalizeDocPaths(body.kbPaths)
    if (!normalized) return NextResponse.json({ error: 'Choose at least one folder' }, { status: 400 })
    kbPaths = normalized
  }

  try {
    await updateRepoSettings(body.repoId, orgId, {
      ...(body.monitoredEvents !== undefined && { monitoredEvents: body.monitoredEvents }),
      ...(body.kbEnabled !== undefined && { kbEnabled: body.kbEnabled }),
      ...(body.autoDeflectEnabled !== undefined && { autoDeflectEnabled: body.autoDeflectEnabled }),
      ...(kbPaths !== undefined && { kbPaths }),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error('repo settings update failed', { module: MOD, requestId: getRequestId(req), orgId, repoId: body.repoId, error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
