import { describe, it, expect } from 'vitest'
import { createTurnContext } from '@/lib/widget/turn-context'
import { widgetContextBlock } from '@/lib/widget/instructions'

/**
 * Everything one widget turn puts in front of the model: the pre-fetched
 * articles plus whatever the model's own searches add. The lead-capture
 * signal, the review queue, usage counts and card grounding all read it.
 */

const pro = { summary: 'Pricing › Pro', answer: '$49 a month.', articleId: 1 }
const team = { summary: 'Pricing › Team', answer: '$149 a month. See https://acme.test/teams', articleId: 2 }
const faq = { summary: 'FAQ', answer: 'Cancel any time.', articleId: 3 }

describe('createTurnContext', () => {
  it('starts with the pre-fetched articles and their matched flag', () => {
    const turn = createTurnContext({ articles: [pro], matched: true })
    expect(turn.articles()).toEqual([pro])
    expect(turn.matched()).toBe(true)
    expect(turn.searches).toBe(0)
    expect(turn.lastSearchQuery).toBeNull()
  })

  it('adds only articles not already supplied, keeping pre-fetched first', () => {
    const turn = createTurnContext({ articles: [pro], matched: false })
    const added = turn.add({ articles: [pro, team], matched: false })
    expect(added).toEqual({ articles: [team], matched: false })
    expect(turn.articles()).toEqual([pro, team])
  })

  it('dedupes articles without an id by their title and text', () => {
    const noId = { summary: 'Hours', answer: 'Nine to five.' }
    const turn = createTurnContext({ articles: [noId], matched: false })
    expect(turn.add({ articles: [{ ...noId }], matched: false }).articles).toEqual([])
    expect(turn.articles()).toHaveLength(1)
  })

  it('stays unmatched while only near misses arrive, and turns matched once a strong match is added', () => {
    const turn = createTurnContext({ articles: [pro], matched: false })
    turn.add({ articles: [faq], matched: false })
    expect(turn.matched()).toBe(false)
    turn.add({ articles: [team], matched: true })
    expect(turn.matched()).toBe(true)
  })

  it('turns matched when a search finds a strong match for an article first supplied as a near miss', () => {
    const turn = createTurnContext({ articles: [pro], matched: false })
    const added = turn.add({ articles: [pro], matched: true })
    expect(added.articles).toEqual([])
    expect(turn.matched()).toBe(true)
    expect(turn.articles()).toEqual([pro])
  })

  it('stays unmatched when a search that claims a match returns nothing', () => {
    const turn = createTurnContext({ articles: [], matched: false })
    turn.add({ articles: [], matched: true })
    expect(turn.matched()).toBe(false)
  })

  it('grows the grounded text with each search that added something', () => {
    const turn = createTurnContext({ articles: [pro], matched: true })
    const before = turn.groundedText()
    expect(before).toBe(widgetContextBlock({ articles: [pro], matched: true }))
    turn.add({ articles: [team], matched: false })
    expect(turn.groundedText()).toBe(before + widgetContextBlock({ articles: [team], matched: false }))
    expect(turn.groundedText()).toContain('https://acme.test/teams')
  })

  it('has empty grounded text when nothing was supplied', () => {
    const turn = createTurnContext({ articles: [], matched: false })
    expect(turn.groundedText()).toBe('')
    turn.add({ articles: [], matched: false })
    expect(turn.groundedText()).toBe('')
  })
})
