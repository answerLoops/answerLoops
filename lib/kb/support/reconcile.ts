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

function tally(items: readonly { summary: SupportSummary }[]) {
  const counts = { supporting: 0, no_support: 0, inconclusive: 0, not_assessed: 0 }
  for (const item of items) {
    if (!SUMMARIES.includes(item.summary)) throw new ReconciliationError(`Unknown summary: ${String(item.summary)}`)
    counts[item.summary]++
  }
  return counts
}

function rate(supporting: number, concluded: number): Rate | null {
  return concluded === 0 ? null : { numerator: supporting, denominator: concluded }
}

/**
 * Counts a population of answer/article pairs into the four buckets, all drawn
 * from the same pairs. Failed generations are reported separately and never
 * counted as supplied or as "not assessed". When the caller knows how many
 * pairs it expects (`expectedSupplied`, counted independently from the
 * references), a mismatch throws instead of showing numbers that do not add up.
 */
export function reconcilePairs(
  items: readonly PairItem[],
  options: { expectedSupplied?: number } = {}
): Reconciliation {
  const completed = items.filter((i) => i.outcome === 'generated')
  const counts = tally(completed)
  const supplied = completed.length
  const sum = counts.supporting + counts.no_support + counts.inconclusive + counts.not_assessed
  if (sum !== supplied) throw new ReconciliationError(`Buckets sum to ${sum}, not the ${supplied} supplied`)
  if (options.expectedSupplied !== undefined && options.expectedSupplied !== supplied) {
    throw new ReconciliationError(`Expected ${options.expectedSupplied} supplied, found ${supplied}`)
  }
  const concluded = counts.supporting + counts.no_support + counts.inconclusive
  return {
    supplied,
    supporting: counts.supporting,
    noSupport: counts.no_support,
    inconclusive: counts.inconclusive,
    notAssessed: counts.not_assessed,
    completedAssessments: concluded,
    supportRate: rate(counts.supporting, concluded),
    failed: { pairs: items.length - completed.length },
  }
}

/**
 * The same, one state per answer. The four states sum to the completed-answer
 * total; failed generations are counted apart. An answer id may appear once.
 */
export function reconcileAnswers(
  items: readonly AnswerItem[],
  options: { expectedCompleted?: number } = {}
): AnswerReconciliation {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.answerId)) throw new ReconciliationError(`Answer ${item.answerId} appears twice`)
    seen.add(item.answerId)
  }
  const completed = items.filter((i) => i.outcome === 'generated')
  const counts = tally(completed)
  const sum = counts.supporting + counts.no_support + counts.inconclusive + counts.not_assessed
  if (sum !== completed.length) throw new ReconciliationError(`States sum to ${sum}, not the ${completed.length} completed answers`)
  if (options.expectedCompleted !== undefined && options.expectedCompleted !== completed.length) {
    throw new ReconciliationError(`Expected ${options.expectedCompleted} completed answers, found ${completed.length}`)
  }
  const concluded = counts.supporting + counts.no_support + counts.inconclusive
  return {
    completed: completed.length,
    supporting: counts.supporting,
    noSupport: counts.no_support,
    inconclusive: counts.inconclusive,
    notAssessed: counts.not_assessed,
    completedAssessments: concluded,
    supportRate: rate(counts.supporting, concluded),
    failed: { answers: items.length - completed.length },
  }
}
