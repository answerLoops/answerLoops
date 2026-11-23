import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { WidgetKBContext } from '@/types'
import type { TurnContext } from '@/lib/widget/turn-context'
import { widgetContextBlock } from '@/lib/widget/instructions'
import { logger } from '@/lib/logger'

/**
 * The widget model's own knowledge-base search.
 *
 * Before the model runs, the widget searches with the visitor's last message.
 * A follow-up such as "and for teams?" means little on its own, so that search
 * misses. With this tool the model writes a standalone question from the
 * conversation ("Team plan price") and searches again. What it finds joins the
 * turn's supplied articles (lib/widget/turn-context.ts), so it is counted,
 * grounded and reviewed exactly like what was found up front.
 *
 * Bounded per message so a model that keeps searching can't run up latency or
 * cost: a search past the limit is refused without running.
 */

export const SEARCH_TOOL_NAME = 'search_knowledge_base'
export const MAX_SEARCHES_PER_TURN = 2

export const NOTHING_NEW = 'No further knowledge-base articles found for that search.'
export const ALREADY_MATCHED = 'The knowledge base context you already have matches this search closely. Answer from it.'
export const LIMIT_REACHED = 'Search limit reached for this message. Answer with what you have.'
export const SEARCH_UNAVAILABLE = 'Knowledge-base search is unavailable right now. Answer with what you have.'

export const searchInputSchema = z.object({
  query: z.string().trim().min(3).max(200),
})

export function buildSearchTool(opts: { turn: TurnContext; search: (query: string) => Promise<WidgetKBContext> }) {
  const { turn, search } = opts
  return createTool({
    id: SEARCH_TOOL_NAME,
    description:
      'Search the knowledge base with a standalone question written from the conversation, for when the knowledge base context you were given does not cover what the visitor is asking — for example a follow-up like "and for teams?", searched as "Team plan price".',
    inputSchema: searchInputSchema,
    execute: async (input: unknown) => {
      const { query } = searchInputSchema.parse(input)
      if (turn.searches >= MAX_SEARCHES_PER_TURN) return LIMIT_REACHED
      turn.searches++
      let found: WidgetKBContext
      try {
        found = await search(query)
      } catch (error) {
        logger.warn('widget knowledge-base search failed', { module: 'widget/search-tool', error })
        return SEARCH_UNAVAILABLE
      }
      turn.lastSearchQuery = query
      const added = turn.add(found)
      // The articles that match were already in front of the model, perhaps
      // labelled as near misses from the visitor's own wording.
      if (added.articles.length === 0) return found.matched && found.articles.length > 0 ? ALREADY_MATCHED : NOTHING_NEW
      return widgetContextBlock(added).replace(/^\n+/, '')
    },
  })
}
