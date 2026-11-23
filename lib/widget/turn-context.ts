import type { PriorAnswer, WidgetKBContext } from '@/types'
import { widgetContextBlock } from '@/lib/widget/instructions'

/**
 * Everything one widget turn puts in front of the model: the articles found
 * before the model ran, plus whatever its own knowledge-base searches add
 * during the turn (lib/widget/search-tool.ts).
 *
 * The lead-capture signal, the review queue, usage counts, answer sources and
 * the link/contact card grounding all read this one record, so an article the
 * model found by searching counts exactly like one it was handed up front.
 */
export interface TurnContext {
  /**
   * Records what a search found. Returns only the articles this turn had not
   * already supplied, with the search's own matched flag, so the caller can
   * show the model just what is new.
   */
  add(found: WidgetKBContext): WidgetKBContext
  /** Every article supplied this turn, pre-fetched first, then in the order searches added them. */
  articles(): PriorAnswer[]
  /** Whether any search this turn, up front or the model's own, found a strong match (not just near misses). */
  matched(): boolean
  /** The reference text the model was shown this turn; links and contact details in cards must appear in it. */
  groundedText(): string
  /** Searches the model has attempted this turn, successful or not. */
  searches: number
  /** The standalone question of the model's last successful search, or null when it never searched. */
  lastSearchQuery: string | null
}

// An article without an id (none today, but PriorAnswer allows it) is the
// same article when its title and text are the same.
const keyOf = (a: PriorAnswer) => (a.articleId !== undefined ? `id:${a.articleId}` : `text:${a.summary}\n${a.answer}`)

export function createTurnContext(initial: WidgetKBContext): TurnContext {
  const supplied: PriorAnswer[] = [...initial.articles]
  const seen = new Set(supplied.map(keyOf))
  let anyMatched = initial.matched && initial.articles.length > 0
  let grounded = widgetContextBlock(initial)

  return {
    searches: 0,
    lastSearchQuery: null,
    add(found) {
      const fresh = found.articles.filter((a) => !seen.has(keyOf(a)))
      for (const a of fresh) {
        seen.add(keyOf(a))
        supplied.push(a)
      }
      const added: WidgetKBContext = { articles: fresh, matched: found.matched }
      // A strong match counts even when the article was already supplied: one
      // found up front as a near miss can match the model's better-worded
      // search, and then the knowledge base did answer the question.
      if (found.matched && found.articles.length > 0) anyMatched = true
      if (fresh.length > 0) grounded += widgetContextBlock(added)
      return added
    },
    articles: () => [...supplied],
    matched: () => anyMatched,
    groundedText: () => grounded,
  }
}
