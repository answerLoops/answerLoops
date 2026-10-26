import { randomUUID } from 'node:crypto'
import { recordAnswerReferences } from '@/lib/db/queries/kb-answers'
import { recordArticleUsage } from '@/lib/db/queries/kb-usage'
import { logger } from '@/lib/logger'
import type { KBAnswerOutcome, KBAnswerSurface } from '@/types'

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

/** A fresh id for one generation. Create it once, before generating, and reuse it for every write about that answer. */
export function newAnswerId(): string {
  return randomUUID()
}

/**
 * Records that an answer was generated, and which knowledge-base articles were
 * supplied to it, beside `countArticleUsage` (which keeps its own aggregate
 * count). Facts only: nothing about the question, the reply or the visitor.
 *
 * Pass the context exactly as it was handed to the model, in the order it was
 * supplied, so an article's rank is its place in that list. Entries without an
 * `articleId` (answers reused from earlier tickets) take up a place but are not
 * recorded. Articles that were retrieved and then dropped before generation are
 * not in that list, so they are never recorded. Retrieval scores are not
 * available at these call sites, so they are stored as null.
 *
 * Use one `answerId` per generation: a retry or a repeated completion callback
 * with the same id writes the answer once, and the first outcome recorded wins.
 *
 * Best-effort by design, like `countArticleUsage`: it runs beside a live answer
 * and must never fail or slow it, so any error is logged and swallowed.
 */
export async function recordAnswerSources(input: {
  orgId: number
  answerId: string
  surface: KBAnswerSurface
  outcome: KBAnswerOutcome
  context: ReadonlyArray<{ articleId?: number }>
}): Promise<void> {
  try {
    const references = input.context.flatMap((c, i) =>
      c.articleId == null ? [] : [{ articleId: c.articleId, rank: i + 1 }]
    )
    await recordAnswerReferences({
      answerId: input.answerId,
      orgId: input.orgId,
      surface: input.surface,
      outcome: input.outcome,
      references,
    })
  } catch (err) {
    logger.error('failed to record knowledge-base answer sources', {
      module: MOD,
      orgId: input.orgId,
      surface: input.surface,
      error: err,
    })
  }
}
