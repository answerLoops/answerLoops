import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * The answer half of lib/widget/lead-signal-stash.ts: the recorded answer a
 * turn produced, with its question and reply, held briefly so the widget can
 * ask for a signed reference to it. It shares the lead-capture stash's entry,
 * expiry and size ceiling, and must not change what the lead-capture side reads.
 */

const TOKEN_A = 'a'.repeat(48)
const TOKEN_B = 'b'.repeat(48)
const ANSWER = { answerId: '3f0c2b9e-5d1a-4c7e-9a43-0b6d8e2f1a77', question: 'how do I export?', answer: 'Use Settings.' }

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('setTurnAnswer / getTurnAnswer', () => {
  it('reads back what was stored for that turn', async () => {
    const { setTurnAnswer, getTurnAnswer } = await import('@/lib/widget/lead-signal-stash')
    setTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1', ANSWER)
    expect(getTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1')).toEqual(ANSWER)
  })

  it('is repeatable: asking twice gets the same answer', async () => {
    const { setTurnAnswer, getTurnAnswer } = await import('@/lib/widget/lead-signal-stash')
    setTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1', ANSWER)
    expect(getTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1')).toEqual(getTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1'))
  })

  it('is scoped to the widget, the visitor and the turn', async () => {
    const { setTurnAnswer, getTurnAnswer } = await import('@/lib/widget/lead-signal-stash')
    setTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1', ANSWER)
    expect(getTurnAnswer(TOKEN_B, 'visitor-a', 'turn-1')).toBeNull()
    expect(getTurnAnswer(TOKEN_A, 'visitor-b', 'turn-1')).toBeNull()
    expect(getTurnAnswer(TOKEN_A, 'visitor-a', 'turn-2')).toBeNull()
  })

  it('expires with the turn entry', async () => {
    const { setTurnAnswer, getTurnAnswer } = await import('@/lib/widget/lead-signal-stash')
    setTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1', ANSWER)
    vi.advanceTimersByTime(61_000)
    expect(getTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1')).toBeNull()
  })

  it('returns null for a turn that has only a lead-capture signal', async () => {
    const { setLeadSignal, getTurnAnswer } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'turn-1', 'no-kb-match', 'q')
    expect(getTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1')).toBeNull()
  })

  it('adds to an existing lead-capture entry without changing what that side reads', async () => {
    const { setLeadSignal, setTurnAnswer, getLeadSignal, getTurnAnswer } = await import('@/lib/widget/lead-signal-stash')
    setLeadSignal(TOKEN_A, 'visitor-a', 'turn-1', 'no-kb-match', 'how do I export?')
    setTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1', ANSWER)
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'turn-1')).toEqual({ signal: 'no-kb-match', question: 'how do I export?' })
    expect(getTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1')).toEqual(ANSWER)
  })

  it('reads back to the lead-capture side exactly like no entry when it was the only thing stored', async () => {
    const { setTurnAnswer, getLeadSignal } = await import('@/lib/widget/lead-signal-stash')
    setTurnAnswer(TOKEN_A, 'visitor-a', 'turn-1', ANSWER)
    expect(getLeadSignal(TOKEN_A, 'visitor-a', 'turn-1')).toEqual({ signal: 'none', question: '' })
  })

  it('stays within the entry ceiling, dropping the oldest first', async () => {
    const { setTurnAnswer, getTurnAnswer } = await import('@/lib/widget/lead-signal-stash')
    setTurnAnswer(TOKEN_A, 'visitor-first', 'turn-1', ANSWER)
    for (let i = 0; i < 5_000; i++) setTurnAnswer(TOKEN_B, 'filler', `t${i}`, ANSWER)
    expect(getTurnAnswer(TOKEN_A, 'visitor-first', 'turn-1')).toBeNull()
    expect(getTurnAnswer(TOKEN_B, 'filler', 't4999')).toEqual(ANSWER)
  })
})
