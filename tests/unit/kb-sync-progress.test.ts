import { describe, it, expect, vi } from 'vitest'
import { throttleProgress } from '@/lib/kb-sync/progress'

describe('throttleProgress', () => {
  it('fires on the first tick, then only every `step` items, then always on the last', () => {
    const sink = vi.fn()
    const report = throttleProgress(sink, 5)
    for (let i = 0; i <= 12; i++) report(i, 12)
    const calls = sink.mock.calls.map((c) => c[0])
    expect(calls).toContain(0) // first
    expect(calls).toContain(12) // last (done === total)
    // between: only multiples-of-5 gaps, never one write per item
    expect(sink.mock.calls.length).toBeLessThan(13)
  })

  it('always fires when done reaches total even below the step gap', () => {
    const sink = vi.fn()
    const report = throttleProgress(sink, 100)
    report(0, 3)
    report(3, 3)
    expect(sink).toHaveBeenCalledWith(3, 3, undefined)
  })

  it('fires when the counter jumps backwards (new phase / offset reset)', () => {
    const sink = vi.fn()
    const report = throttleProgress(sink, 5)
    report(10, 20)
    sink.mockClear()
    report(2, 8) // discussions phase after repo phase — lower number
    expect(sink).toHaveBeenCalledWith(2, 8, undefined)
  })

  it('passes the item title through to the sink when the caller provides one', () => {
    const sink = vi.fn()
    const report = throttleProgress(sink, 100)
    report(0, 2, 'Onboarding Guide')
    expect(sink).toHaveBeenCalledWith(0, 2, 'Onboarding Guide')
  })
})
