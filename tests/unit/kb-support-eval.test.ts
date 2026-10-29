import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { evaluateDataset, truthFor, type Dataset, type DatasetCase } from '@/lib/kb/support/eval'
import { formatEvaluation } from '@/lib/kb/support/eval-report'
import { buildSnapshot } from '@/lib/kb/support/snapshot'
import type { JudgeFn } from '@/lib/kb/support/assess'
import type { EmbedFn } from '@/lib/kb/support/similarity'

const real = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/source-support/dataset.json'), 'utf-8')) as Dataset

const sameEmbed: EmbedFn = async (texts) => ({ embeddings: texts.map(() => [1, 0]), tokens: texts.length })

/** A judge that returns what a perfect human would, found by matching the prompt to a case. */
function perfectJudge(cases: DatasetCase[]): JudgeFn {
  const byPrompt = new Map(cases.map((c) => [c.id, truthFor(c)]))
  return async ({ prompt }) => {
    for (const [, t] of byPrompt) {
      if (prompt.includes(`QUESTION: ${t.snapshot.question}\n`) && t.snapshot.claims.every((c) => prompt.includes(`[${c.index}] ${c.text}`)) && t.snapshot.articles.every((a) => prompt.includes(`ARTICLE ${a.id}:`))) {
        return { raw: t.idealOutput, usage: { inputTokens: 2000, outputTokens: 200 } }
      }
    }
    throw new Error('no case matches this prompt')
  }
}

describe('evaluateDataset on the real dataset', () => {
  it('a judge that agrees with the human labels scores perfectly and has no disagreements', async () => {
    const report = await evaluateDataset(real, { judge: perfectJudge(real.cases), embed: sameEmbed })
    expect(report.cases).toBe(36)
    expect(report.disagreements).toEqual([])
    for (const label of ['supports', 'partial', 'contradicts', 'none'] as const) {
      const m = report.perLabel[label]
      expect(m.truePositives).toBe(m.actual)
      expect(m.truePositives).toBe(m.predicted)
    }
    expect(report.outcomes).toMatchObject({ rejected: 0, failed: 0 })
    expect(report.answerStateAccuracy).toEqual({ matched: 36, total: 36 })
    for (const acc of Object.values(report.articleStateAccuracy)) expect(acc.matched).toBe(acc.total)
  })

  it('says the labels are unreviewed while the dataset says so', async () => {
    const report = await evaluateDataset(real, { judge: perfectJudge(real.cases), embed: sameEmbed })
    expect(report.labelsReviewed).toBe(false)
    expect(formatEvaluation(report)).toMatch(/UNREVIEWED LABELS/)
  })

  it('stops saying so once a person has reviewed the dataset', async () => {
    const report = await evaluateDataset({ ...real, reviewed: true, reviewedBy: 'a reviewer' }, { judge: perfectJudge(real.cases), embed: sameEmbed })
    expect(formatEvaluation(report)).not.toMatch(/UNREVIEWED/)
  })

  it('can run one case type at a time', async () => {
    const report = await evaluateDataset(real, { judge: perfectJudge(real.cases), embed: sameEmbed }, { types: ['duplicate_sources'] })
    expect(report.cases).toBe(3)
  })

  it('a sycophantic judge that marks every pair supports is measured as imprecise, with its mistakes listed', async () => {
    // Every claim, every article, supports passage 1: it agrees with everything.
    const judge: JudgeFn = async ({ prompt }) => {
      const t = real.cases.map(truthFor).find((x) => prompt.includes(`QUESTION: ${x.snapshot.question}\n`) && x.snapshot.articles.every((a) => prompt.includes(`ARTICLE ${a.id}:`)) && x.snapshot.claims.every((c) => prompt.includes(`[${c.index}] ${c.text}`)))!
      return {
        raw: {
          findings: t.snapshot.articles.flatMap((a) => t.snapshot.claims.map((c) => ({ claim: c.index, article: a.id, passage: a.passages.length ? 1 : null, label: a.passages.length ? 'supports' : 'none' }))),
          off_topic: [],
        },
      }
    }
    const report = await evaluateDataset(real, { judge, embed: sameEmbed })
    expect(report.perLabel.supports.precision).toBeLessThan(0.6)
    expect(report.perLabel.supports.recall).toBe(1)
    expect(report.disagreements.length).toBeGreaterThan(20)
  })

  it('counts rejected and failed runs separately instead of folding them into the labels', async () => {
    let n = 0
    const flaky: JudgeFn = async (call) => {
      n++
      if (n % 3 === 0) throw new Error('boom')
      if (n % 3 === 1) return { raw: { findings: [{ claim: 99, article: 1, passage: 1, label: 'supports' }], off_topic: [] } }
      return perfectJudge(real.cases)(call)
    }
    const report = await evaluateDataset(real, { judge: flaky, embed: sameEmbed })
    expect(report.outcomes.failed).toBeGreaterThan(0)
    expect(report.outcomes.rejected).toBeGreaterThan(0)
    expect(report.outcomes.completed + report.outcomes.rejected + report.outcomes.failed + report.outcomes.skipped).toBe(36)
    expect(report.perLabel.supports.predicted).toBeLessThan(report.perLabel.supports.actual)
  })
})

describe('evaluateDataset arithmetic, on a small dataset worked out by hand', () => {
  const tiny: Dataset = {
    version: 1,
    reviewed: true,
    reviewedBy: 'test',
    cases: [
      {
        id: 'tiny-1',
        type: 'direct_support',
        note: 'two claims, two articles',
        question: 'q',
        answer: 'Alpha is red. Beta is blue.',
        articles: [
          { id: 1, question: 'A', answer: 'Alpha is red.' },
          { id: 2, question: 'B', answer: 'Gamma is green.' },
        ],
        labels: [{ claim: 'Alpha is red.', article: 1, label: 'supports', evidence: 'Alpha is red' }],
        expect: { answer: 'supporting', articles: { '1': 'supporting', '2': 'no_support' } },
      },
    ],
  }
  // Human: (1,1)=supports, every other pair none. The judge says: (1,1) supports,
  // (2,1) supports (wrong), (1,2) partial (wrong), (2,2) none.
  const judge: JudgeFn = async () => ({
    raw: {
      findings: [
        { claim: 1, article: 1, passage: 1, label: 'supports' },
        { claim: 1, article: 2, passage: 1, label: 'supports' },
        { claim: 2, article: 1, passage: 1, label: 'partial' },
        { claim: 2, article: 2, passage: null, label: 'none' },
      ],
      off_topic: [],
    },
    usage: { inputTokens: 1000, outputTokens: 100 },
  })

  it('computes precision and recall per label from the confusion matrix', async () => {
    const r = await evaluateDataset(tiny, { judge, embed: sameEmbed })
    expect(r.pairs).toBe(4)
    expect(r.perLabel.supports).toMatchObject({ predicted: 2, actual: 1, truePositives: 1, precision: 0.5, recall: 1 })
    expect(r.perLabel.partial).toMatchObject({ predicted: 1, actual: 0, truePositives: 0, precision: 0, recall: null })
    expect(r.perLabel.none).toMatchObject({ predicted: 1, actual: 3, truePositives: 1, recall: 1 / 3 })
    expect(r.perLabel.contradicts).toMatchObject({ predicted: 0, actual: 0, precision: null, recall: null })
  })

  it('lists exactly the pairs where the evaluator and the human differ', async () => {
    const r = await evaluateDataset(tiny, { judge, embed: sameEmbed })
    expect(r.disagreements.map((d) => [d.article, d.claim, d.human, d.evaluator])).toEqual([
      [1, 'Beta is blue.', 'none', 'partial'],
      [2, 'Alpha is red.', 'none', 'supports'],
    ])
  })

  it('measures the effect of the similarity check: it lowers the unsupported support and keeps the real one', async () => {
    const embed: EmbedFn = async (texts) => ({
      // Only "Alpha is red." and its own passage line up; the unrelated passage is orthogonal.
      embeddings: texts.map((t) => (t === 'Gamma is green.' ? [0, 1] : [1, 0])),
      tokens: 10,
    })
    const r = await evaluateDataset(tiny, { judge, embed })
    expect(r.judgeOnlySupports).toMatchObject({ predicted: 2, truePositives: 1, precision: 0.5 })
    expect(r.downgrade).toMatchObject({ judgeSupports: 2, downgraded: 1, rate: 0.5 })
    expect(r.perLabel.supports).toMatchObject({ predicted: 1, truePositives: 1, precision: 1, recall: 1 })
    const swept = Object.fromEntries(r.floorSweep.map((s) => [s.floor, s]))
    expect(swept[0.5]).toMatchObject({ kept: 1, precision: 1, recall: 1 })
  })

  it('its floor sweep never keeps more at a higher floor', async () => {
    const embed: EmbedFn = async (texts) => ({ embeddings: texts.map((_, i) => [1, i / 10]), tokens: 1 })
    const r = await evaluateDataset(tiny, { judge, embed })
    const kept = r.floorSweep.map((s) => s.kept)
    for (let i = 1; i < kept.length; i++) expect(kept[i]).toBeLessThanOrEqual(kept[i - 1])
  })

  it('averages tokens only over answers that were actually assessed', async () => {
    const r = await evaluateDataset(tiny, { judge, embed: sameEmbed })
    expect(r.tokensPerAnswer).toMatchObject({ judgeInput: 1000, judgeOutput: 100 })
  })

  it('reports no token figure when nothing was assessed', async () => {
    const r = await evaluateDataset(tiny, { judge: async () => { throw new Error('down') }, embed: sameEmbed })
    expect(r.tokensPerAnswer).toBeNull()
    expect(r.outcomes.failed).toBe(1)
    expect(r.perLabel.supports.predicted).toBe(0)
  })

  it('treats pairs from a failed run as disagreements with the reason as the evaluator label', async () => {
    const r = await evaluateDataset(tiny, { judge: async () => { throw new Error('down') }, embed: sameEmbed })
    expect(new Set(r.disagreements.map((d) => d.evaluator))).toEqual(new Set(['failed']))
  })
})

describe('truthFor', () => {
  const c: DatasetCase = {
    id: 'x',
    type: 'direct_support',
    note: 'a note for the reviewer',
    question: 'q',
    answer: 'Alpha is red.',
    articles: [{ id: 1, question: 'A', answer: 'Alpha is red.\n\nAlpha is red too.' }],
    labels: [],
    expect: { answer: 'no_support', articles: { '1': 'no_support' } },
  }

  it('rejects a label whose claim text is not a claim of the answer', () => {
    expect(() => truthFor({ ...c, labels: [{ claim: 'Beta is blue.', article: 1, label: 'none' }] })).toThrow(/matches 0 claims/)
  })
  it('rejects a label for an article that is not in the case', () => {
    expect(() => truthFor({ ...c, labels: [{ claim: 'Alpha is red.', article: 5, label: 'none' }] })).toThrow(/not in the case/)
  })
  it('rejects evidence that matches no passage, or more than one', () => {
    expect(() => truthFor({ ...c, labels: [{ claim: 'Alpha is red.', article: 1, label: 'supports', evidence: 'Zed' }] })).toThrow(/matches 0 passages/)
    expect(() => truthFor({ ...c, labels: [{ claim: 'Alpha is red.', article: 1, label: 'supports', evidence: 'Alpha is red' }] })).toThrow(/matches 2 passages/)
  })
  it('rejects a supports, partial or contradicts label with no evidence', () => {
    expect(() => truthFor({ ...c, labels: [{ claim: 'Alpha is red.', article: 1, label: 'partial' }] })).toThrow(/needs evidence/)
  })
  it('resolves ids from the same segmentation the assessment uses', () => {
    const t = truthFor({ ...c, labels: [{ claim: 'Alpha is red.', article: 1, label: 'supports', evidence: 'red too' }] })
    expect(t.truth.get('1:1')).toEqual({ label: 'supports', passage: 2 })
    expect(t.snapshot).toEqual(buildSnapshot({ question: c.question, answer: c.answer, articles: c.articles }))
  })
})
