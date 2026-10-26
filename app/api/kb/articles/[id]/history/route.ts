import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getArticleHistory } from '@/lib/db/queries/kb-events'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/kb/articles/[id]/history'

/**
 * The history of one knowledge-base article. Any member of the workspace can
 * read it; an article from another workspace reads as not found.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
    const { id } = await ctx.params
    const articleId = Number(id)
    if (!Number.isInteger(articleId) || articleId < 1) return Response.json({ error: 'Invalid ID' }, { status: 400 })
    const events = await getArticleHistory(articleId, access.orgId)
    if (!events) return Response.json({ error: 'Article not found' }, { status: 404 })
    return Response.json({ events })
  } catch (err) {
    logger.error('failed to load KB article history', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
