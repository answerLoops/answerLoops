import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { deleteArticle } from '@/lib/db/queries/kb'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/kb/articles/[id]'

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const orgId = session.orgId ?? DEFAULT_ORG_ID
    const { id } = await ctx.params
    const articleId = Number(id)
    if (!Number.isInteger(articleId)) return Response.json({ error: 'Invalid ID' }, { status: 400 })
    await deleteArticle(articleId, orgId)
    return new Response(null, { status: 204 })
  } catch (err) {
    logger.error('failed to delete KB article', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
