import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { deleteArticle } from '@/lib/db/queries/kb'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/kb/articles/[id]'

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
    const orgId = access.orgId
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
