import type { SupportSummary } from './summary'

export type GenerationOutcome = 'generated' | 'failed'

export interface PairItem {
  answerId: string
  /** Whether the answer itself was generated; a failed generation has no assessment to count. */
  outcome: GenerationOutcome
  summary: SupportSummary
}

export interface AnswerItem {
  answerId: string
  outcome: GenerationOutcome
  summary: SupportSummary
}

/** A rate with the numbers it came from, so it is never shown without its denominator. */
export interface Rate {
  numerator: number
  denominator: number
}

export interface Reconciliation {
  /** Completed-generation population: the four buckets below always sum to this. */
  supplied: number
  supporting: number
  noSupport: number
  inconclusive: number
  notAssessed: number
  /** supporting + noSupport + inconclusive: the pairs an evaluator actually concluded something about. */
  completedAssessments: number
  /** supporting out of completedAssessments, or null when nothing was assessed. */
  supportRate: Rate | null
  /** Failed generations, reported on their own and left out of every figure above. */
  failed: { pairs: number }
}

export interface AnswerReconciliation {
  completed: number
  supporting: number
  noSupport: number
  inconclusive: number
  notAssessed: number
  completedAssessments: number
  supportRate: Rate | null
  failed: { answers: number }
}

export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReconciliationError'
  }
}

const SUMMARIES: readonly SupportSummary[] = ['supporting', 'no_support', 'inconclusive', 'not_assessed']

/** A count of pairs or answers that share an outcome and a summary, as a database groups them. */
export interface Group {
  outcome: GenerationOutcome
  summary: SupportSummary
  count: number
}

function checkGroups(groups: readonly Group[]) {
  for (const g of groups) {
    if (!SUMMARIES.includes(g.summary)) throw new ReconciliationError(`Unknown summary: ${String(g.summary)}`)
    if (g.outcome !== 'generated' && g.outcome !== 'failed') throw new ReconciliationError(`Unknown outcome: ${String(g.outcome)}`)
    if (!Number.isInteger(g.count) || g.count < 0) throw new ReconciliationError(`Bad count: ${String(g.count)}`)
  }
}

function tallyGroups(groups: readonly Group[]) {
  checkGroups(groups)
  const completed = { supporting: 0, no_support: 0, inconclusive: 0, not_assessed: 0 }
  let failed = 0
  for (const g of groups) {
    if (g.outcome === 'generated') completed[g.summary] += g.count
    else failed += g.count
  }
  return { completed, failed }
}

function rate(supporting: number, concluded: number): Rate | null {
  return concluded === 0 ? null : { numerator: supporting, denominator: concluded }
}

/**
 * Counts pairs the way a database groups them (outcome, summary, count), so a
 * large population never has to be loaded row by row. Failed generations are
 * reported separately and never counted as supplied or as "not assessed". When
 * the caller knows how many pairs it expects (`expectedSupplied`, counted
 * independently from the references), a mismatch throws instead of showing
 * numbers that do not add up.
 */
export function reconcilePairGroups(groups: readonly Group[], options: { expectedSupplied?: number } = {}): Reconciliation {
  const { completed: c, failed } = tallyGroups(groups)
  const supplied = c.supporting + c.no_support + c.inconclusive + c.not_assessed
  if (options.expectedSupplied !== undefined && options.expectedSupplied !== supplied) {
    throw new ReconciliationError(`Expected ${options.expectedSupplied} supplied, found ${supplied}`)
  }
  const concluded = c.supporting + c.no_support + c.inconclusive
  return {
    supplied,
    supporting: c.supporting,
    noSupport: c.no_support,
    inconclusive: c.inconclusive,
    notAssessed: c.not_assessed,
    completedAssessments: concluded,
    supportRate: rate(c.supporting, concluded),
    failed: { pairs: failed },
  }
}

/** The same, one state per answer: the four states sum to the completed-answer total. */
export function reconcileAnswerGroups(groups: readonly Group[], options: { expectedCompleted?: number } = {}): AnswerReconciliation {
  const { completed: c, failed } = tallyGroups(groups)
  const completed = c.supporting + c.no_support + c.inconclusive + c.not_assessed
  if (options.expectedCompleted !== undefined && options.expectedCompleted !== completed) {
    throw new ReconciliationError(`Expected ${options.expectedCompleted} completed answers, found ${completed}`)
  }
  const concluded = c.supporting + c.no_support + c.inconclusive
  return {
    completed,
    supporting: c.supporting,
    noSupport: c.no_support,
    inconclusive: c.inconclusive,
    notAssessed: c.not_assessed,
    completedAssessments: concluded,
    supportRate: rate(c.supporting, concluded),
    failed: { answers: failed },
  }
}

function groupsOf(items: readonly { outcome: GenerationOutcome; summary: SupportSummary }[]): Group[] {
  const counts = new Map<string, Group>()
  for (const item of items) {
    const key = `${item.outcome}:${item.summary}`
    const group = counts.get(key)
    if (group) group.count++
    else counts.set(key, { outcome: item.outcome, summary: item.summary, count: 1 })
  }
  return [...counts.values()]
}

/**
 * Counts a population of answer/article pairs into the four buckets, all drawn
 * from the same pairs. See reconcilePairGroups for how failed generations and
 * an expected total are handled.
 */
export function reconcilePairs(items: readonly PairItem[], options: { expectedSupplied?: number } = {}): Reconciliation {
  return reconcilePairGroups(groupsOf(items), options)
}

/** The same, one state per answer. An answer id may appear once. */
export function reconcileAnswers(items: readonly AnswerItem[], options: { expectedCompleted?: number } = {}): AnswerReconciliation {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.answerId)) throw new ReconciliationError(`Answer ${item.answerId} appears twice`)
    seen.add(item.answerId)
  }
  return reconcileAnswerGroups(groupsOf(items), options)
}
