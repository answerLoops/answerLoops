import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getArticleAnswerView } from '@/lib/db/queries/kb-answers'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/kb/articles/[id]/answers'

/**
 * The recent answers one article was supplied to as context: which channel,
 * when, the outcome, and whether the article has changed since. Owners and
 * admins only. An article from another workspace reads as not found. No
 * question or answer text is stored, so none is returned.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireOrgAccess(['owner', 'admin'])
    if (!access.ok) return Response.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })
    const { id } = await ctx.params
    const articleId = Number(id)
    if (!Number.isInteger(articleId) || articleId < 1) return Response.json({ error: 'Invalid ID' }, { status: 400 })
    const answers = await getArticleAnswerView(articleId, access.orgId)
    if (!answers) return Response.json({ error: 'Article not found' }, { status: 404 })
    return Response.json({ answers })
  } catch (err) {
    logger.error('failed to load KB article answers', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
