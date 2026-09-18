import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { deleteKBSource, setKBSourcePublished } from '@/lib/db/queries/kb-sources'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/kb/sources/[id]'

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const orgId = session.orgId ?? DEFAULT_ORG_ID
    const { id } = await ctx.params
    const sourceId = Number(id)
    if (!Number.isInteger(sourceId)) return Response.json({ error: 'Invalid ID' }, { status: 400 })
    await deleteKBSource(sourceId, orgId)
    return new Response(null, { status: 204 })
  } catch (err) {
    logger.error('failed to delete KB source', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Toggle whether a source (and all its chunks) is served to retrieval / the widget. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const orgId = session.orgId ?? DEFAULT_ORG_ID
    const { id } = await ctx.params
    const sourceId = Number(id)
    if (!Number.isInteger(sourceId)) return Response.json({ error: 'Invalid ID' }, { status: 400 })

    const body = (await req.json().catch(() => null)) as { published?: unknown } | null
    if (body?.published !== 0 && body?.published !== 1) {
      return Response.json({ error: 'published must be 0 or 1' }, { status: 400 })
    }

    await setKBSourcePublished(sourceId, orgId, body.published)
    return new Response(null, { status: 204 })
  } catch (err) {
    logger.error('failed to update KB source published state', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
