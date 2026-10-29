import { describe, it, expect } from 'vitest'
import {
  FAIL_REASONS,
  IllegalTransitionError,
  SKIP_REASONS,
  isTerminal,
  transition,
  type Execution,
  type ExecutionEvent,
} from '@/lib/kb/support/state'

const states: Execution[] = [
  { state: 'not_scheduled' },
  { state: 'pending' },
  { state: 'running' },
  { state: 'completed' },
  { state: 'failed', reason: 'timeout' },
  { state: 'skipped', reason: 'over_budget' },
]
const events: ExecutionEvent[] = [
  { type: 'schedule' },
  { type: 'start' },
  { type: 'complete' },
  { type: 'fail', reason: 'timeout' },
  { type: 'skip', reason: 'over_budget' },
]

// from-state -> event -> expected next state (anything absent must throw)
const allowed: Record<string, Record<string, Execution>> = {
  not_scheduled: { schedule: { state: 'pending' }, skip: { state: 'skipped', reason: 'over_budget' } },
  pending: { start: { state: 'running' }, skip: { state: 'skipped', reason: 'over_budget' }, fail: { state: 'failed', reason: 'timeout' } },
  running: { complete: { state: 'completed' }, fail: { state: 'failed', reason: 'timeout' } },
  completed: { complete: { state: 'completed' } },
  failed: { fail: { state: 'failed', reason: 'timeout' } },
  skipped: { skip: { state: 'skipped', reason: 'over_budget' } },
}

describe('execution transitions', () => {
  for (const from of states) {
    for (const event of events) {
      const next = allowed[from.state][event.type]
      if (next) {
        it(`${from.state} + ${event.type} -> ${next.state}`, () => {
          expect(transition(from, event).execution).toEqual(next)
        })
      } else {
        it(`${from.state} + ${event.type} is refused`, () => {
          expect(() => transition(from, event)).toThrow(IllegalTransitionError)
        })
      }
    }
  }

  it('a move that really changes the state says so', () => {
    expect(transition({ state: 'not_scheduled' }, { type: 'schedule' }).changed).toBe(true)
    expect(transition({ state: 'running' }, { type: 'complete' }).changed).toBe(true)
  })

  it('completing twice is idempotent: the repeat changes nothing', () => {
    const first = transition({ state: 'running' }, { type: 'complete' })
    const again = transition(first.execution, { type: 'complete' })
    expect(again).toEqual({ execution: { state: 'completed' }, changed: false })
  })

  it('skipping or failing again for the same reason is a no-op, but for a different reason is refused', () => {
    expect(transition({ state: 'skipped', reason: 'disabled' }, { type: 'skip', reason: 'disabled' }).changed).toBe(false)
    expect(() => transition({ state: 'skipped', reason: 'disabled' }, { type: 'skip', reason: 'over_budget' })).toThrow(IllegalTransitionError)
    expect(transition({ state: 'failed', reason: 'timeout' }, { type: 'fail', reason: 'timeout' }).changed).toBe(false)
    expect(() => transition({ state: 'failed', reason: 'timeout' }, { type: 'fail', reason: 'no_result' })).toThrow(IllegalTransitionError)
  })

  it('an assessment that never ran cannot be completed', () => {
    for (const from of [{ state: 'not_scheduled' }, { state: 'pending' }] as Execution[]) {
      expect(() => transition(from, { type: 'complete' })).toThrow(IllegalTransitionError)
    }
  })

  it('a failed or skipped assessment cannot later complete or restart', () => {
    for (const from of [{ state: 'failed', reason: 'timeout' }, { state: 'skipped', reason: 'disabled' }] as Execution[]) {
      for (const type of ['complete', 'start', 'schedule'] as const) {
        expect(() => transition(from, { type } as ExecutionEvent)).toThrow(IllegalTransitionError)
      }
    }
  })

  it('carries each skip and fail reason through', () => {
    for (const reason of SKIP_REASONS) expect(transition({ state: 'pending' }, { type: 'skip', reason }).execution).toEqual({ state: 'skipped', reason })
    for (const reason of FAIL_REASONS) expect(transition({ state: 'running' }, { type: 'fail', reason }).execution).toEqual({ state: 'failed', reason })
  })

  it('does not change the state it was given', () => {
    const from: Execution = { state: 'pending' }
    transition(from, { type: 'start' })
    expect(from).toEqual({ state: 'pending' })
  })

  it('names the illegal move in its message', () => {
    expect(() => transition({ state: 'pending' }, { type: 'complete' })).toThrow(/complete an assessment that is pending/)
  })

  it('knows which states are terminal', () => {
    expect(states.filter(isTerminal).map((s) => s.state)).toEqual(['completed', 'failed', 'skipped'])
  })
})
