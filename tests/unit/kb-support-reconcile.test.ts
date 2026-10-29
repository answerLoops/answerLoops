import { describe, it, expect } from 'vitest'
import { ReconciliationError, reconcileAnswers, reconcilePairs, type PairItem } from '@/lib/kb/support/reconcile'
import type { SupportSummary } from '@/lib/kb/support/summary'

const pairs = (spec: Record<SupportSummary, number>, outcome: PairItem['outcome'] = 'generated'): PairItem[] => {
  const out: PairItem[] = []
  let n = 0
  for (const [summary, count] of Object.entries(spec) as Array<[SupportSummary, number]>) {
    for (let i = 0; i < count; i++) out.push({ answerId: `a${n++}`, outcome, summary })
  }
  return out
}

describe('reconcilePairs: the worked example', () => {
  // 100 supplied pairs: 20 supporting, 35 no support, 5 inconclusive, 40 not assessed.
  const items = pairs({ supporting: 20, no_support: 35, inconclusive: 5, not_assessed: 40 })

  it('reconciles exactly: 100 = 20 + 35 + 5 + 40', () => {
    const r = reconcilePairs(items, { expectedSupplied: 100 })
    expect(r).toMatchObject({ supplied: 100, supporting: 20, noSupport: 35, inconclusive: 5, notAssessed: 40 })
    expect(r.supporting + r.noSupport + r.inconclusive + r.notAssessed).toBe(r.supplied)
  })

  it('states the support rate with its denominator: 20 of 60 completed assessments, not 20 of 100', () => {
    const r = reconcilePairs(items)
    expect(r.completedAssessments).toBe(60)
    expect(r.supportRate).toEqual({ numerator: 20, denominator: 60 })
  })

  it('does not fold the not-assessed pairs into the rate or into "no support"', () => {
    const r = reconcilePairs(items)
    expect(r.noSupport).toBe(35)
    expect(r.supportRate!.denominator).not.toBe(r.supplied)
  })
})

describe('reconcilePairs: counts that do not add up are refused', () => {
  it('throws when the population is not the number the caller counted independently', () => {
    const items = pairs({ supporting: 2, no_support: 1, inconclusive: 0, not_assessed: 1 })
    expect(() => reconcilePairs(items, { expectedSupplied: 5 })).toThrow(ReconciliationError)
    expect(() => reconcilePairs(items, { expectedSupplied: 3 })).toThrow(/Expected 3 supplied, found 4/)
    expect(() => reconcilePairs(items, { expectedSupplied: 4 })).not.toThrow()
  })

  it('throws on a summary it does not know, rather than dropping the pair from every bucket', () => {
    const items = [{ answerId: 'a', outcome: 'generated', summary: 'used' }] as unknown as PairItem[]
    expect(() => reconcilePairs(items)).toThrow(/Unknown summary: used/)
  })

  it('always sums, for any mix', () => {
    for (let n = 0; n < 40; n++) {
      const spec = { supporting: n % 7, no_support: n % 5, inconclusive: n % 3, not_assessed: n % 11 }
      const r = reconcilePairs(pairs(spec))
      expect(r.supporting + r.noSupport + r.inconclusive + r.notAssessed).toBe(r.supplied)
    }
  })
})

describe('reconcilePairs: failed generations', () => {
  it('are reported on their own and left out of supplied and every bucket', () => {
    const items = [
      ...pairs({ supporting: 3, no_support: 2, inconclusive: 1, not_assessed: 4 }),
      ...pairs({ supporting: 0, no_support: 0, inconclusive: 0, not_assessed: 7 }, 'failed'),
    ]
    const r = reconcilePairs(items)
    expect(r.supplied).toBe(10)
    expect(r.notAssessed).toBe(4)
    expect(r.failed).toEqual({ pairs: 7 })
    expect(r.supporting + r.noSupport + r.inconclusive + r.notAssessed).toBe(10)
  })

  it('ignore whatever summary a failed generation carries', () => {
    const r = reconcilePairs([{ answerId: 'a', outcome: 'failed', summary: 'supporting' }])
    expect(r).toMatchObject({ supplied: 0, supporting: 0, failed: { pairs: 1 } })
  })
})

describe('reconcilePairs: edge cases', () => {
  it('has no rate when nothing was concluded, instead of dividing by zero', () => {
    const r = reconcilePairs(pairs({ supporting: 0, no_support: 0, inconclusive: 0, not_assessed: 5 }))
    expect(r.completedAssessments).toBe(0)
    expect(r.supportRate).toBeNull()
  })

  it('reconciles an empty population', () => {
    expect(reconcilePairs([])).toMatchObject({ supplied: 0, completedAssessments: 0, supportRate: null, failed: { pairs: 0 } })
  })

  it('counts inconclusive in the denominator', () => {
    const r = reconcilePairs(pairs({ supporting: 1, no_support: 0, inconclusive: 3, not_assessed: 0 }))
    expect(r.supportRate).toEqual({ numerator: 1, denominator: 4 })
  })
})

describe('reconcileAnswers', () => {
  const answers = (spec: Record<SupportSummary, number>, outcome: PairItem['outcome'] = 'generated') => pairs(spec, outcome)

  it('sums to the completed-answer total, with failed generations apart', () => {
    const items = [
      ...answers({ supporting: 12, no_support: 8, inconclusive: 2, not_assessed: 18 }),
      ...answers({ supporting: 0, no_support: 0, inconclusive: 0, not_assessed: 3 }, 'failed').map((i, n) => ({ ...i, answerId: `f${n}` })),
    ]
    const r = reconcileAnswers(items, { expectedCompleted: 40 })
    expect(r).toMatchObject({ completed: 40, supporting: 12, noSupport: 8, inconclusive: 2, notAssessed: 18, failed: { answers: 3 } })
    expect(r.supportRate).toEqual({ numerator: 12, denominator: 22 })
  })

  it('throws when the completed total is not what the caller expected', () => {
    expect(() => reconcileAnswers(answers({ supporting: 1, no_support: 0, inconclusive: 0, not_assessed: 0 }), { expectedCompleted: 2 })).toThrow(/Expected 2 completed answers, found 1/)
  })

  it('throws when an answer appears twice', () => {
    const items: PairItem[] = [
      { answerId: 'same', outcome: 'generated', summary: 'supporting' },
      { answerId: 'same', outcome: 'generated', summary: 'no_support' },
    ]
    expect(() => reconcileAnswers(items)).toThrow(/appears twice/)
  })

  it('shows failed, pending, disabled and over-budget answers as not assessed', () => {
    const r = reconcileAnswers(answers({ supporting: 1, no_support: 1, inconclusive: 0, not_assessed: 3 }))
    expect(r.notAssessed).toBe(3)
    expect(r.completedAssessments).toBe(2)
  })
})
