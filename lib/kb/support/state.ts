/**
 * Where one assessment is in its life, kept apart from what it found. A check
 * that failed, was skipped or never started has no finding at all, so it can
 * never read as "no supporting evidence found".
 */
export const SKIP_REASONS = ['disabled', 'not_sampled', 'over_budget', 'over_cap', 'no_claims'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

export const FAIL_REASONS = ['timeout', 'provider_error', 'no_result', 'interrupted'] as const
export type FailReason = (typeof FAIL_REASONS)[number]

export type Execution =
  | { state: 'not_scheduled' }
  | { state: 'pending' }
  | { state: 'running' }
  | { state: 'completed' }
  | { state: 'failed'; reason: FailReason }
  | { state: 'skipped'; reason: SkipReason }

export type ExecutionState = Execution['state']

export type ExecutionEvent =
  | { type: 'schedule' }
  | { type: 'start' }
  | { type: 'complete' }
  | { type: 'fail'; reason: FailReason }
  | { type: 'skip'; reason: SkipReason }

export class IllegalTransitionError extends Error {
  constructor(from: Execution, event: ExecutionEvent) {
    super(`Cannot ${event.type} an assessment that is ${from.state}`)
    this.name = 'IllegalTransitionError'
  }
}

/**
 * Moves an assessment to its next state. Anything not in the table throws, so a
 * bug cannot, for example, complete an assessment that never ran. Repeating the
 * move that already happened (a retried callback completing, skipping or
 * failing for the same reason) is a no-op, reported as `changed: false`.
 */
export function transition(from: Execution, event: ExecutionEvent): { execution: Execution; changed: boolean } {
  switch (from.state) {
    case 'not_scheduled':
      if (event.type === 'schedule') return { execution: { state: 'pending' }, changed: true }
      if (event.type === 'skip') return { execution: { state: 'skipped', reason: event.reason }, changed: true }
      break
    case 'pending':
      if (event.type === 'start') return { execution: { state: 'running' }, changed: true }
      if (event.type === 'skip') return { execution: { state: 'skipped', reason: event.reason }, changed: true }
      if (event.type === 'fail') return { execution: { state: 'failed', reason: event.reason }, changed: true }
      break
    case 'running':
      if (event.type === 'complete') return { execution: { state: 'completed' }, changed: true }
      if (event.type === 'fail') return { execution: { state: 'failed', reason: event.reason }, changed: true }
      break
    case 'completed':
      if (event.type === 'complete') return { execution: from, changed: false }
      break
    case 'failed':
      if (event.type === 'fail' && event.reason === from.reason) return { execution: from, changed: false }
      break
    case 'skipped':
      if (event.type === 'skip' && event.reason === from.reason) return { execution: from, changed: false }
      break
  }
  throw new IllegalTransitionError(from, event)
}

export function isTerminal(execution: Execution): boolean {
  return execution.state === 'completed' || execution.state === 'failed' || execution.state === 'skipped'
}
