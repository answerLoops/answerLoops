import { describe, expect, it } from 'vitest'
import { groupFlagsByArticle } from '@/lib/widget/flag-groups'
import type { AnswerFlag } from '@/lib/db/queries/widget-answer-flags'

/**
 * lib/widget/flag-groups.ts: flagged answers grouped by the article they cited,
 * so a team fixes a source once and clears every flag that pointed at it.
 */

const flag = (id: number, cited: { id: number; question: string }[] = [], over: Partial<AnswerFlag> = {}): AnswerFlag => ({
  id,
  verdict: 'down',
  reason: 'wrong_information',
  note: null,
  question: `q${id}`,
  answer: `a${id}`,
  cited_articles: cited,
  lead_id: null,
  status: 'open',
  resolved_at: null,
  created_at: '2026-11-20T10:00:00Z',
  ...over,
})

const EXPORT = { id: 4, question: 'How do I export?' }
const PRICING = { id: 9, question: 'What does it cost?' }

describe('groupFlagsByArticle', () => {
  it('groups flags under the article each cited and counts each flag once per article', () => {
    const { groups, uncited } = groupFlagsByArticle([flag(1, [EXPORT]), flag(2, [EXPORT]), flag(3, [PRICING])])
    expect(uncited).toEqual([])
    expect(groups.map((g) => [g.articleId, g.flags.map((f) => f.id)])).toEqual([
      [4, [1, 2]],
      [9, [3]],
    ])
  })

  it('lists a flag under every article it cited', () => {
    const { groups } = groupFlagsByArticle([flag(1, [EXPORT, PRICING]), flag(2, [PRICING])])
    expect(groups.find((g) => g.articleId === 9)!.flags.map((f) => f.id)).toEqual([1, 2])
    expect(groups.find((g) => g.articleId === 4)!.flags.map((f) => f.id)).toEqual([1])
  })

  it('does not count a flag twice for an article that appears twice in its citations', () => {
    const { groups } = groupFlagsByArticle([flag(1, [EXPORT, EXPORT])])
    expect(groups).toHaveLength(1)
    expect(groups[0].flags).toHaveLength(1)
  })

  it('puts flags with no cited article that still exists in their own list', () => {
    const { groups, uncited } = groupFlagsByArticle([flag(1, []), flag(2, [EXPORT])])
    expect(uncited.map((f) => f.id)).toEqual([1])
    expect(groups).toHaveLength(1)
  })

  it('orders the most-flagged article first, then by title, so the order is stable', () => {
    const A = { id: 1, question: 'Alpha' }
    const B = { id: 2, question: 'Beta' }
    const C = { id: 3, question: 'Gamma' }
    const { groups } = groupFlagsByArticle([flag(1, [C]), flag(2, [B]), flag(3, [A]), flag(4, [C]), flag(5, [B]), flag(6, [C])])
    expect(groups.map((g) => g.question)).toEqual(['Gamma', 'Beta', 'Alpha'])
    const reversed = groupFlagsByArticle([flag(6, [C]), flag(5, [B]), flag(4, [C]), flag(3, [A]), flag(2, [B]), flag(1, [C])])
    expect(reversed.groups.map((g) => g.question)).toEqual(['Gamma', 'Beta', 'Alpha'])
  })

  it('keeps the order the flags came in within a group', () => {
    const { groups } = groupFlagsByArticle([flag(30, [EXPORT]), flag(10, [EXPORT]), flag(20, [EXPORT])])
    expect(groups[0].flags.map((f) => f.id)).toEqual([30, 10, 20])
  })

  it('returns nothing for no flags', () => {
    expect(groupFlagsByArticle([])).toEqual({ groups: [], uncited: [] })
  })
})
