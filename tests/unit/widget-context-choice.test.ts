import { describe, it, expect } from 'vitest'
import { chooseWidgetContext } from '@/lib/kb/widget-context'

// Which articles the widget hands the assistant: every article that clears the
// match bar, or, when none does, the closest ones above the near-miss floor.

const hit = (id: number, score: number) => ({ id, question: `Q${id}`, answer: 'A', score })

describe('chooseWidgetContext', () => {
  it('keeps only strong matches when there are any', () => {
    expect(chooseWidgetContext([hit(1, 0.7), hit(2, 0.46), hit(3, 0.35)])).toEqual({ results: [hit(1, 0.7), hit(2, 0.46)], matched: true })
  })

  it('falls back to near misses when nothing clears the bar', () => {
    expect(chooseWidgetContext([hit(3, 0.38), hit(4, 0.31)])).toEqual({ results: [hit(3, 0.38), hit(4, 0.31)], matched: false })
  })

  it('returns nothing when nothing is close', () => {
    expect(chooseWidgetContext([])).toEqual({ results: [], matched: false })
  })
})
