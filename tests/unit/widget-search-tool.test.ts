import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() } }))

import { buildSearchTool, MAX_SEARCHES_PER_TURN, SEARCH_TOOL_NAME, searchInputSchema } from '@/lib/widget/search-tool'
import { createTurnContext } from '@/lib/widget/turn-context'
import type { WidgetKBContext } from '@/types'

/**
 * The widget model's own knowledge-base search. It writes a standalone
 * question from the conversation ("Team plan price" for "and for teams?"),
 * and what it finds joins the turn's supplied articles.
 */

const pro = { summary: 'Pricing › Pro', answer: '$49 a month.', articleId: 1 }
const team = { summary: 'Pricing › Team', answer: '$149 a month.', articleId: 2 }

type Exec = (input: unknown, ctx: unknown) => Promise<string>
const setup = (initial: WidgetKBContext, search: (q: string) => Promise<WidgetKBContext>) => {
  const turn = createTurnContext(initial)
  const searchFn = vi.fn(search)
  const tool = buildSearchTool({ turn, search: searchFn })
  const run = (query: string) => (tool as unknown as { execute: Exec }).execute({ query }, {})
  return { turn, searchFn, run, tool }
}

beforeEach(() => h.warn.mockClear())

describe('search_knowledge_base tool', () => {
  it('is named search_knowledge_base and allows two searches per message', () => {
    expect(SEARCH_TOOL_NAME).toBe('search_knowledge_base')
    expect(MAX_SEARCHES_PER_TURN).toBe(2)
    const { tool } = setup({ articles: [], matched: false }, async () => ({ articles: [], matched: false }))
    expect((tool as unknown as { id: string }).id).toBe('search_knowledge_base')
  })

  it('returns what it found as reference material and adds it to the turn', async () => {
    const { turn, run, searchFn } = setup({ articles: [pro], matched: false }, async () => ({ articles: [team], matched: true }))
    const out = await run('  Team plan price  ')
    expect(searchFn).toHaveBeenCalledWith('Team plan price')
    expect(out.startsWith('Knowledge base context — use this to answer.')).toBe(true)
    expect(out).toContain('$149 a month.')
    expect(out).not.toContain('$49 a month.')
    expect(turn.articles()).toEqual([pro, team])
    expect(turn.matched()).toBe(true)
    expect(turn.searches).toBe(1)
    expect(turn.lastSearchQuery).toBe('Team plan price')
  })

  it('labels near misses as near misses', async () => {
    const { run } = setup({ articles: [], matched: false }, async () => ({ articles: [team], matched: false }))
    const out = await run('Team plan price')
    expect(out).toContain('closest ones found')
  })

  it('says nothing new was found when every result was already supplied', async () => {
    const { turn, run } = setup({ articles: [pro], matched: true }, async () => ({ articles: [pro], matched: false }))
    expect(await run('Pro plan price')).toBe('No further knowledge-base articles found for that search.')
    expect(turn.articles()).toEqual([pro])
    expect(turn.lastSearchQuery).toBe('Pro plan price')
  })

  it('points the model back at its context when the search strongly matches articles it already has', async () => {
    const { turn, run } = setup({ articles: [pro], matched: false }, async () => ({ articles: [pro], matched: true }))
    expect(await run('Pro plan price')).toBe('The knowledge base context you already have matches this search closely. Answer from it.')
    expect(turn.matched()).toBe(true)
  })

  it('says nothing new was found when the search comes back empty', async () => {
    const { run } = setup({ articles: [], matched: false }, async () => ({ articles: [], matched: false }))
    expect(await run('Enterprise SSO')).toBe('No further knowledge-base articles found for that search.')
  })

  it('refuses a third search without searching', async () => {
    const { turn, run, searchFn } = setup({ articles: [], matched: false }, async () => ({ articles: [], matched: false }))
    await run('first question')
    await run('second question')
    expect(await run('third question')).toBe('Search limit reached for this message. Answer with what you have.')
    expect(searchFn).toHaveBeenCalledTimes(2)
    expect(turn.searches).toBe(2)
    expect(turn.lastSearchQuery).toBe('second question')
  })

  it('refuses the third of three searches started at the same time', async () => {
    const { run, searchFn } = setup({ articles: [], matched: false }, async () => ({ articles: [], matched: false }))
    const results = await Promise.all([run('first question'), run('second question'), run('third question')])
    expect(searchFn).toHaveBeenCalledTimes(2)
    expect(results.filter((r) => r === 'Search limit reached for this message. Answer with what you have.')).toHaveLength(1)
  })

  it('reports search as unavailable when it fails, without throwing, and counts the attempt', async () => {
    let calls = 0
    const { turn, run, searchFn } = setup({ articles: [], matched: false }, async () => {
      calls++
      if (calls === 1) throw new Error('embedding down')
      return { articles: [team], matched: true }
    })
    expect(await run('Team plan price')).toBe('Knowledge-base search is unavailable right now. Answer with what you have.')
    expect(h.warn).toHaveBeenCalledTimes(1)
    expect(turn.lastSearchQuery).toBeNull()
    await run('Team plan price')
    expect(await run('again')).toBe('Search limit reached for this message. Answer with what you have.')
    expect(searchFn).toHaveBeenCalledTimes(2)
  })
})

describe('search_knowledge_base input', () => {
  it('accepts a trimmed question of 3 to 200 characters', () => {
    expect(searchInputSchema.parse({ query: '  Team plan  ' })).toEqual({ query: 'Team plan' })
    expect(searchInputSchema.safeParse({ query: 'ab' }).success).toBe(false)
    expect(searchInputSchema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false)
    expect(searchInputSchema.safeParse({ query: '      ' }).success).toBe(false)
  })
})
