import { requireOrgAccess } from '@/lib/auth/org'
import { getKnowledgeCoverage } from '@/lib/db/queries/kb-coverage'
import { getArticleUsage } from '@/lib/db/queries/kb-usage'
import { getWidgetAnswerSettings } from '@/lib/db/queries/widgets'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/kb/coverage'

/**
 * What the chat assistant can answer from, grouped by source — the data behind
 * the Knowledge coverage tab. Org-scoped like every sibling kb route.
 *
 * Also carries the widget's answer scope, so the tab can say what a visitor
 * gets for a question no article covers. `widgetAnswerScope` is null when it
 * could not be read; the rest of the tab still loads.
 */
export async function GET(request: Request) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
    const [coverage, usageResult, widgetAnswerScope] = await Promise.all([
      getKnowledgeCoverage(access.orgId),
      getArticleUsage(access.orgId)
        .then((articleUsage) => ({ articleUsage, articleUsageAvailable: true as const }))
        .catch((err) => {
          logger.error('failed to load knowledge article usage', {
            module: MOD,
            requestId: getRequestId(request),
            orgId: access.orgId,
            error: err,
          })
          return { articleUsage: [], articleUsageAvailable: false as const }
        }),
      getWidgetAnswerSettings(access.orgId)
        .then((settings) => settings.answerScope)
        .catch((err) => {
          logger.error('failed to load widget answer scope for knowledge coverage', {
            module: MOD,
            requestId: getRequestId(request),
            orgId: access.orgId,
            error: err,
          })
          return null
        }),
    ])
    return Response.json({ ...coverage, ...usageResult, widgetAnswerScope })
  } catch (err) {
    logger.error('failed to load knowledge coverage', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
