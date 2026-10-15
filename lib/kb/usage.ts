import { recordArticleUsage } from '@/lib/db/queries/kb-usage'
import { logger } from '@/lib/logger'

const MOD = 'kb/usage'

/**
 * Counts an answer against the knowledge-base articles that were supplied to
 * the assistant as context for it.
 *
 * Best-effort by design: it runs beside the live answer path (a widget reply, a
 * ticket draft) and must never fail or slow it, so any error is logged and
 * swallowed. Pass it only the entries that came from articles; entries without
 * an `articleId` (answers reused from earlier tickets) are ignored.
 */
export async function countArticleUsage(
  orgId: number,
  context: ReadonlyArray<{ articleId?: number }>
): Promise<void> {
  try {
    const ids = context.flatMap((c) => (c.articleId == null ? [] : [c.articleId]))
    await recordArticleUsage(orgId, ids)
  } catch (err) {
    logger.error('failed to record knowledge-base article usage', { module: MOD, orgId, error: err })
  }
}
