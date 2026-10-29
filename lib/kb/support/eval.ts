import { assessSupport, type AssessDeps, type SupportAssessment } from './assess'
import { buildSnapshot, type SupportSnapshot } from './snapshot'
import type { Execution } from './state'
import { deriveAnswerSupport, deriveArticleSupport, type NoSupportReason, type SupportSummary } from './summary'
import { JUDGE_LABELS, validateJudgeOutput, type JudgeLabel } from './validate'

/**
 * The human-reviewed dataset and the measurements taken against it. Labels are
 * written by a person, per claim and article, in terms of the claim's own text
 * and a snippet of the passage that is the evidence, so they survive a change
 * to numbering and a segmentation change shows up as a failed lookup. The
 * judge is never asked to label its own dataset.
 */
export const CASE_TYPES = [
  'direct_support',
  'paraphrase',
  'partial_support',
  'synthesis_across_sources',
  'duplicate_sources',
  'relevant_but_unreflected',
  'off_topic_vs_duplicate',
  'irrelevant_context',
  'conflicting_sources',
  'no_sources',
  'instruction_in_article',
  'instruction_in_answer',
] as const
export type CaseType = (typeof CASE_TYPES)[number]

export interface DatasetCase {
  id: string
  type: CaseType
  /** Why the labels are what they are, for the person reviewing them. */
  note: string
  question: string
  answer: string
  articles: Array<{ id: number; question: string; answer: string }>
  /** Every claim and article pair not listed here is `none`. */
  labels: Array<{ claim: string; article: number; label: JudgeLabel; evidence?: string }>
  /** Articles a person says are about nothing any claim is about. */
  offTopic?: number[]
  /** What a person expects the derived states to be. */
  expect: {
    answer: SupportSummary
    articles: Record<string, SupportSummary>
    reasons?: Record<string, NoSupportReason[]>
    sharedWith?: Record<string, number[]>
  }
}

export interface Dataset {
  version: number
  /** True only once a person has checked every label. The report says so loudly while it is false. */
  reviewed: boolean
  reviewedBy: string | null
  cases: DatasetCase[]
}

export class DatasetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatasetError'
  }
}

export interface CaseTruth {
  snapshot: SupportSnapshot
  /** The human label for every claim and article pair, keyed "article:claim". */
  truth: Map<string, { label: JudgeLabel; passage: number | null }>
  offTopic: number[]
  /** What a perfect judge would return, for checking the dataset against the code that derives states. */
  idealOutput: { findings: Array<{ claim: number; article: number; passage: number | null; label: JudgeLabel }>; off_topic: number[] }
}

/** Resolves a case's human labels to ids in the snapshot built from its own text. */
export function truthFor(c: DatasetCase): CaseTruth {
  const snapshot = buildSnapshot({ question: c.question, answer: c.answer, articles: c.articles })
  const truth = new Map<string, { label: JudgeLabel; passage: number | null }>()
  const offTopic = [...(c.offTopic ?? [])].sort((a, b) => a - b)

  for (const article of snapshot.articles) {
    for (const claim of snapshot.claims) truth.set(`${article.id}:${claim.index}`, { label: 'none', passage: null })
  }
  for (const l of c.labels) {
    const claims = snapshot.claims.filter((x) => x.text === l.claim)
    if (claims.length !== 1) throw new DatasetError(`${c.id}: claim "${l.claim}" matches ${claims.length} claims`)
    const article = snapshot.articles.find((a) => a.id === l.article)
    if (!article) throw new DatasetError(`${c.id}: article ${l.article} is not in the case`)
    let passage: number | null = null
    if (l.label !== 'none') {
      if (!l.evidence) throw new DatasetError(`${c.id}: a ${l.label} label needs evidence`)
      const hits = article.passages.filter((p) => p.text.includes(l.evidence!))
      if (hits.length !== 1) throw new DatasetError(`${c.id}: evidence "${l.evidence}" matches ${hits.length} passages of article ${l.article}`)
      passage = hits[0].index
    }
    truth.set(`${article.id}:${claims[0].index}`, { label: l.label, passage })
  }

  const findings = [...truth.entries()]
    .map(([key, v]) => {
      const [article, claim] = key.split(':').map(Number)
      return { claim, article, passage: v.passage, label: v.label }
    })
    .filter((f) => !offTopic.includes(f.article))
    .sort((a, b) => a.article - b.article || a.claim - b.claim)
  return { snapshot, truth, offTopic, idealOutput: { findings, off_topic: offTopic } }
}

/**
 * Checks that a case's human labels agree with the states a person expects once
 * the same code that judges real output derives them from a perfect judge's
 * answer. A mismatch means the labels and the expectation contradict each other
 * (or the labels contradict the rubric), so it is caught before any model runs.
 * Returns the problems found; an empty list means the case is consistent.
 */
export function checkCaseConsistency(c: DatasetCase): string[] {
  const { snapshot, idealOutput } = truthFor(c)
  const validation = validateJudgeOutput(snapshot, idealOutput)
  if (!validation.ok) return [`${c.id}: the labels do not form a valid judge output (${validation.kind})`]

  const completed: Execution = { state: 'completed' }
  const articles = deriveArticleSupport(snapshot, { execution: completed, validation })
  const problems: string[] = []

  for (const article of snapshot.articles) {
    const expected = c.expect.articles[String(article.id)]
    const got = articles.find((a) => a.articleId === article.id)!
    if (expected === undefined) problems.push(`${c.id}: no expected state for article ${article.id}`)
    else if (got.summary !== expected) problems.push(`${c.id}: article ${article.id} is ${got.summary}, expected ${expected}`)

    const reasons = c.expect.reasons?.[String(article.id)]
    if (reasons && JSON.stringify([...reasons].sort()) !== JSON.stringify([...got.reasons].sort())) {
      problems.push(`${c.id}: article ${article.id} reasons are [${got.reasons}], expected [${reasons}]`)
    }
    const shared = c.expect.sharedWith?.[String(article.id)]
    if (shared && JSON.stringify([...shared].sort()) !== JSON.stringify(got.sharedWith)) {
      problems.push(`${c.id}: article ${article.id} shares with [${got.sharedWith}], expected [${shared}]`)
    }
  }
  const answer = deriveAnswerSupport(completed, articles)
  if (answer !== c.expect.answer) problems.push(`${c.id}: the answer is ${answer}, expected ${c.expect.answer}`)
  return problems
}

export interface PairOutcome {
  caseId: string
  type: CaseType
  claim: string
  article: number
  human: JudgeLabel
  /** What the evaluator ended with: a label, `inconclusive` after a downgrade, or why there is none. */
  evaluator: JudgeLabel | 'inconclusive' | 'rejected' | 'failed' | 'skipped'
}

export interface LabelMetrics {
  /** Pairs the evaluator gave this label. */
  predicted: number
  /** Pairs a person gave this label. */
  actual: number
  truePositives: number
  precision: number | null
  recall: number | null
}

export interface EvaluationReport {
  cases: number
  pairs: number
  /** False until a person has reviewed every label: nothing in this report is a measurement before then. */
  labelsReviewed: boolean
  perLabel: Record<JudgeLabel, LabelMetrics>
  /** What the judge alone said before the similarity check, so the check's own effect is visible. */
  judgeOnlySupports: { predicted: number; truePositives: number; precision: number | null }
  downgrade: { judgeSupports: number; downgraded: number; rate: number | null; embeddingUnavailable: number }
  outcomes: { completed: number; rejected: number; failed: number; skipped: number }
  articleStateAccuracy: Record<string, { matched: number; total: number }>
  answerStateAccuracy: { matched: number; total: number }
  disagreements: PairOutcome[]
  floorSweep: Array<{ floor: number; kept: number; precision: number | null; recall: number | null }>
  tokensPerAnswer: { judgeInput: number; judgeOutput: number; embedding: number } | null
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den)

export interface EvaluationOptions {
  types?: readonly CaseType[]
  floors?: readonly number[]
}

/**
 * Runs the whole assessment on every case and measures it against the human
 * labels: precision and recall per label, the effect of the similarity floor,
 * how often output was rejected or failed, and every disagreement. It makes no
 * claim about accuracy by itself; the report is only as good as the labels.
 */
export async function evaluateDataset(
  dataset: Dataset,
  deps: AssessDeps,
  options: EvaluationOptions = {}
): Promise<EvaluationReport> {
  const cases = dataset.cases.filter((c) => !options.types || options.types.includes(c.type))
  const outcomes: PairOutcome[] = []
  const counts = { completed: 0, rejected: 0, failed: 0, skipped: 0 }
  const articleAcc: Record<string, { matched: number; total: number }> = {}
  const answerAcc = { matched: 0, total: 0 }
  const judgeSupports: Array<{ score: number; truthSupports: boolean }> = []
  let downgraded = 0
  let unavailable = 0
  let judgeOnlyTp = 0
  const tokens = { judgeInput: 0, judgeOutput: 0, embedding: 0, answers: 0 }
  let truthSupportsTotal = 0

  for (const c of cases) {
    const { snapshot, truth } = truthFor(c)
    for (const t of truth.values()) if (t.label === 'supports') truthSupportsTotal++
    const result: SupportAssessment = await assessSupport(snapshot, deps)

    const validation = result.validation
    let state: 'completed' | 'rejected' | 'failed' | 'skipped'
    if (result.execution.state === 'failed') state = 'failed'
    else if (result.execution.state === 'skipped') state = 'skipped'
    else if (validation && !validation.ok) state = 'rejected'
    else state = 'completed'
    counts[state]++

    if (state === 'completed' && snapshot.articles.length > 0) {
      tokens.judgeInput += result.usage.judgeInputTokens
      tokens.judgeOutput += result.usage.judgeOutputTokens
      tokens.embedding += result.usage.embeddingTokens
      tokens.answers++
    }
    if (result.similarity.unavailable) unavailable++

    const finals = new Map<string, PairOutcome['evaluator']>()
    if (state === 'completed' && validation?.ok) {
      for (const f of validation.findings) finals.set(`${f.article}:${f.claim}`, f.label)
      for (const article of snapshot.articles) {
        for (const claim of snapshot.claims) {
          const key = `${article.id}:${claim.index}`
          // A pair the judge left out is "none" only when it flagged the whole article off topic.
          if (!finals.has(key) && validation.offTopic.includes(article.id)) finals.set(key, 'none')
        }
      }
    }

    for (const [key, t] of truth) {
      const [articleId, claimIndex] = key.split(':').map(Number)
      const claim = snapshot.claims.find((x) => x.index === claimIndex)!
      const evaluator: PairOutcome['evaluator'] = state === 'completed' ? (finals.get(key) ?? 'rejected') : state
      outcomes.push({ caseId: c.id, type: c.type, claim: claim.text, article: articleId, human: t.label, evaluator })

      const score = result.similarity.scores[key]
      const judgedSupports = evaluator === 'supports' || (evaluator === 'inconclusive' && score !== undefined)
      if (judgedSupports) {
        judgeSupports.push({ score: score ?? Number.NaN, truthSupports: t.label === 'supports' })
        if (t.label === 'supports') judgeOnlyTp++
        if (evaluator === 'inconclusive') downgraded++
      }
    }

    // Derived states against what a person expected.
    for (const [id, expected] of Object.entries(c.expect.articles)) {
      const bucket = (articleAcc[c.type] ??= { matched: 0, total: 0 })
      bucket.total++
      if (result.articles.find((a) => a.articleId === Number(id))?.summary === expected) bucket.matched++
    }
    answerAcc.total++
    if (result.answer === c.expect.answer) answerAcc.matched++
  }

  const perLabel = Object.fromEntries(
    JUDGE_LABELS.map((label) => {
      const predicted = outcomes.filter((o) => o.evaluator === label).length
      const actual = outcomes.filter((o) => o.human === label).length
      const tp = outcomes.filter((o) => o.evaluator === label && o.human === label).length
      return [label, { predicted, actual, truePositives: tp, precision: ratio(tp, predicted), recall: ratio(tp, actual) }]
    })
  ) as Record<JudgeLabel, LabelMetrics>

  const floors = options.floors ?? [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]
  const floorSweep = floors.map((floor) => {
    const kept = judgeSupports.filter((s) => Number.isFinite(s.score) && s.score >= floor)
    const tp = kept.filter((s) => s.truthSupports).length
    return { floor, kept: kept.length, precision: ratio(tp, kept.length), recall: ratio(tp, truthSupportsTotal) }
  })

  return {
    cases: cases.length,
    pairs: outcomes.length,
    labelsReviewed: dataset.reviewed,
    perLabel,
    judgeOnlySupports: { predicted: judgeSupports.length, truePositives: judgeOnlyTp, precision: ratio(judgeOnlyTp, judgeSupports.length) },
    downgrade: { judgeSupports: judgeSupports.length, downgraded, rate: ratio(downgraded, judgeSupports.length), embeddingUnavailable: unavailable },
    outcomes: counts,
    articleStateAccuracy: articleAcc,
    answerStateAccuracy: answerAcc,
    disagreements: outcomes.filter((o) => o.evaluator !== o.human),
    floorSweep,
    tokensPerAnswer:
      tokens.answers === 0
        ? null
        : {
            judgeInput: Math.round(tokens.judgeInput / tokens.answers),
            judgeOutput: Math.round(tokens.judgeOutput / tokens.answers),
            embedding: Math.round(tokens.embedding / tokens.answers),
          },
  }
}
