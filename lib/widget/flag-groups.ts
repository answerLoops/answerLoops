import type { AnswerFlag } from '@/lib/db/queries/widget-answer-flags'

export interface FlagArticleGroup {
  articleId: number
  /** The article's question, as it reads now. */
  question: string
  /** Every flagged answer that cited this article, newest first (the order they came in). */
  flags: AnswerFlag[]
}

export interface GroupedFlags {
  /** One group per cited article, the most-flagged first. */
  groups: FlagArticleGroup[]
  /** Flagged answers that cited no article that still exists, so there is nothing to fix at the source. */
  uncited: AnswerFlag[]
}

/**
 * Groups flagged answers by the article they cited, so a team fixes the source
 * once and clears every flag that pointed at it. A flag that cited several
 * articles appears under each, and counts once under each. A flag with no
 * cited article left (the answer came from general knowledge, or its articles
 * were deleted since) goes in `uncited`. Groups are ordered by how many flags
 * they hold, then by title, so the order does not shuffle between loads.
 */
export function groupFlagsByArticle(flags: AnswerFlag[]): GroupedFlags {
  const byArticle = new Map<number, FlagArticleGroup>()
  const uncited: AnswerFlag[] = []
  for (const flag of flags) {
    if (flag.cited_articles.length === 0) {
      uncited.push(flag)
      continue
    }
    const seen = new Set<number>()
    for (const article of flag.cited_articles) {
      // An article listed twice on one flag still counts once for it.
      if (seen.has(article.id)) continue
      seen.add(article.id)
      const group = byArticle.get(article.id) ?? { articleId: article.id, question: article.question, flags: [] }
      group.flags.push(flag)
      byArticle.set(article.id, group)
    }
  }
  const groups = [...byArticle.values()].sort(
    (a, b) => b.flags.length - a.flags.length || a.question.localeCompare(b.question) || a.articleId - b.articleId
  )
  return { groups, uncited }
}
