import { JUDGE_LABELS } from './validate'
import type { EvaluationReport } from './eval'

const pct = (n: number | null) => (n === null ? '   n/a' : `${(n * 100).toFixed(1).padStart(5)}%`)

/**
 * The report as text, for a person reading a terminal. It leads with whether
 * the labels have been reviewed, because until they have, none of the numbers
 * below are a measurement of anything.
 */
export function formatEvaluation(report: EvaluationReport, extra: { costMicrosPerAnswer?: number | null } = {}): string {
  const out: string[] = []
  if (!report.labelsReviewed) {
    out.push(
      '*** UNREVIEWED LABELS: a person has not yet checked this dataset. Nothing below is a measured accuracy. ***',
      ''
    )
  }
  out.push(`${report.cases} cases, ${report.pairs} claim/article pairs`)
  out.push(
    `Runs: ${report.outcomes.completed} completed, ${report.outcomes.rejected} rejected (judge output unusable), ` +
      `${report.outcomes.failed} failed, ${report.outcomes.skipped} skipped`,
    ''
  )

  out.push('Per label (evaluator vs human)', '  label        predicted  actual  precision  recall')
  for (const label of JUDGE_LABELS) {
    const m = report.perLabel[label]
    out.push(`  ${label.padEnd(12)} ${String(m.predicted).padStart(9)}  ${String(m.actual).padStart(6)}  ${pct(m.precision)}    ${pct(m.recall)}`)
  }

  const j = report.judgeOnlySupports
  out.push(
    '',
    `Judge alone said supports for ${j.predicted} pairs, ${pct(j.precision)} of them right.`,
    `The similarity check lowered ${report.downgrade.downgraded} of ${report.downgrade.judgeSupports} (${pct(report.downgrade.rate)}) to inconclusive.` +
      (report.downgrade.embeddingUnavailable > 0 ? ` Embeddings were unavailable for ${report.downgrade.embeddingUnavailable} cases, so those had all support lowered.` : ''),
    '',
    'Similarity floor sweep (judge supports only)',
    '  floor   kept  precision  recall'
  )
  for (const s of report.floorSweep) out.push(`  ${s.floor.toFixed(2)}  ${String(s.kept).padStart(5)}  ${pct(s.precision)}    ${pct(s.recall)}`)

  out.push('', 'Derived article states matching the human expectation, by case type')
  for (const [type, acc] of Object.entries(report.articleStateAccuracy)) out.push(`  ${type.padEnd(28)} ${acc.matched}/${acc.total}`)
  out.push(`Answer-level states matching: ${report.answerStateAccuracy.matched}/${report.answerStateAccuracy.total}`)

  if (report.tokensPerAnswer) {
    const t = report.tokensPerAnswer
    out.push(
      '',
      `Tokens per assessed answer: judge ${t.judgeInput} in / ${t.judgeOutput} out, embeddings ${t.embedding}` +
        (extra.costMicrosPerAnswer != null ? `; about $${(extra.costMicrosPerAnswer / 1_000_000).toFixed(5)} per answer` : '')
    )
  }

  out.push('', `Disagreements with the human labels: ${report.disagreements.length}`)
  for (const d of report.disagreements) {
    out.push(`  [${d.caseId}] article ${d.article}: human ${d.human}, evaluator ${d.evaluator} — "${d.claim.slice(0, 70)}"`)
  }
  return out.join('\n')
}
