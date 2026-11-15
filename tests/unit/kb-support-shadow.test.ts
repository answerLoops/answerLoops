import { describe, expect, it } from 'vitest'
import {
  agreementBetween,
  allocateStrata,
  buildLabelTemplate,
  buildShadowFiles,
  buildShadowReport,
  combineColumns,
  decideVerdict,
  drawStratifiedSample,
  formatShadowReport,
  seededShuffle,
  summarizeCost,
  validateLabelsFile,
  ShadowLabelError,
  ShadowSampleError,
  SHADOW_JUDGE_LABELS,
  type HumanLabel,
  type LabelColumn,
  type ShadowCandidate,
  type ShadowJudgeLabel,
  type ShadowKey,
  type ShadowKeyItem,
  type ShadowPopulation,
  type VerdictInput,
} from '@/lib/kb/support/shadow'
import { SHADOW_ABSTENTION_RULE, SHADOW_LABELER_ROLES, SHADOW_TARGETS } from '@/lib/kb/support/targets'
import { SUPPORT_COST_CEILING_MICROS, SUPPORT_METHOD } from '@/lib/kb/support/method'

// The shadow run's pure layer (#446): sampling, the blind file, label
// validation, agreement, the report and the go/no-go verdict. No database, no
// model and no filesystem.

const POPULATION: ShadowPopulation = {
  assessments: { completed: 10, failed: 2, skipped: 3 },
  answers: { supporting: 6, no_support: 2, inconclusive: 2, not_assessed: 5 },
  articles: { supporting: 8, no_support: 4, inconclusive: 3 },
  claimFindings: { supports: 20, partial: 5, contradicts: 2, inconclusive: 3 },
}
const COST = { ceilingMicros: 3000, priced: 10, unpriced: 0, meanMicros: 500, maxMicros: 900, overCeiling: 0 }

function candidates(counts: Partial<Record<ShadowJudgeLabel, number>>): ShadowCandidate[] {
  const out: ShadowCandidate[] = []
  let id = 700_001
  for (const label of SHADOW_JUDGE_LABELS) {
    for (let i = 0; i < (counts[label] ?? 0); i++) {
      const n = id++
      out.push({
        findingId: n,
        articleFindingId: n + 100_000,
        assessmentId: n + 200_000,
        answerId: `MARKER-ANSWER-${n}`,
        surface: 'MARKER-SURFACE',
        judgeLabel: label,
        articleSummary: label === 'supports' ? 'supporting' : 'inconclusive',
        answerSummary: label === 'supports' ? 'supporting' : 'inconclusive',
        sharedWithCount: n % 5 === 0 ? 1 : 0,
        articleFindingsInAnswer: n % 3 === 0 ? 2 : 1,
        answerHasContradiction: label === 'contradicts',
      })
    }
  }
  return out
}

const excerptsFor = (cs: readonly ShadowCandidate[]) =>
  new Map(cs.map((c) => [c.findingId, { claim: `Claim sentence number ${c.findingId}.`, passage: `Passage sentence number ${c.findingId}.` }]))

describe('sampling', () => {
  it('shuffles deterministically, without touching the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const a = seededShuffle(input, 's')
    expect(seededShuffle(input, 's')).toEqual(a)
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect([...a].sort((x, y) => x - y)).toEqual(input)
    expect(seededShuffle(input, 'other')).not.toEqual(a)
  })

  it('is the same sample for the same pool, size and seed, whatever order the rows came in', () => {
    const pool = candidates({ supports: 60, partial: 20, contradicts: 10, inconclusive: 10 })
    const a = drawStratifiedSample(pool, 50, 'seed-1')
    const b = drawStratifiedSample([...pool].reverse(), 50, 'seed-1')
    expect(b.selected.map((c) => c.findingId)).toEqual(a.selected.map((c) => c.findingId))
    expect(drawStratifiedSample(pool, 50, 'seed-2').selected.map((c) => c.findingId)).not.toEqual(a.selected.map((c) => c.findingId))
    expect(new Set(a.selected.map((c) => c.findingId)).size).toBe(50)
  })

  it('allocates in proportion to each label, and records it', () => {
    const pool = candidates({ supports: 60, partial: 20, contradicts: 10, inconclusive: 10 })
    const { selected, strata } = drawStratifiedSample(pool, 50, 'x')
    expect(strata).toEqual({
      supports: { population: 60, sampled: 30 },
      partial: { population: 20, sampled: 10 },
      contradicts: { population: 10, sampled: 5 },
      inconclusive: { population: 10, sampled: 5 },
    })
    for (const l of SHADOW_JUDGE_LABELS) expect(selected.filter((c) => c.judgeLabel === l)).toHaveLength(strata[l].sampled)
  })

  it('gives every non-empty label at least one item when there is room, and the total is always the size', () => {
    const pool = candidates({ supports: 97, partial: 1, contradicts: 1, inconclusive: 1 })
    const { strata } = drawStratifiedSample(pool, 10, 'x')
    for (const l of SHADOW_JUDGE_LABELS) expect(strata[l].sampled).toBeGreaterThanOrEqual(1)
    expect(Object.values(strata).reduce((s, x) => s + x.sampled, 0)).toBe(10)
    for (const n of [1, 3, 7, 33, 99, 100]) {
      const alloc = allocateStrata({ a: 50, b: 30, c: 19, d: 1 }, n, ['a', 'b', 'c', 'd'] as const)
      expect(alloc.a + alloc.b + alloc.c + alloc.d).toBe(n)
    }
  })

  it('mixes the strata, so an item\'s position says nothing about its label', () => {
    const pool = candidates({ supports: 40, partial: 40, contradicts: 40, inconclusive: 40 })
    const order = drawStratifiedSample(pool, 40, 'x').selected.map((c) => SHADOW_JUDGE_LABELS.indexOf(c.judgeLabel))
    const sorted = [...order].sort((a, b) => a - b)
    expect(order).not.toEqual(sorted)
  })

  it('refuses a size larger than the pool, or below one, and says how many exist', () => {
    const pool = candidates({ supports: 3 })
    expect(() => drawStratifiedSample(pool, 4, 'x')).toThrow(/Only 3 findings with stored excerpts exist; 4 were requested/)
    expect(() => drawStratifiedSample(pool, 0, 'x')).toThrow(ShadowSampleError)
    expect(() => drawStratifiedSample([...pool, pool[0]], 2, 'x')).toThrow(/twice/)
  })
})

describe('the blind labeling file', () => {
  const pool = candidates({ supports: 12, partial: 4, contradicts: 2, inconclusive: 2 })
  const sample = drawStratifiedSample(pool, 20, 'blind')
  const files = buildShadowFiles({
    orgId: 42,
    seed: 'blind',
    createdAt: '2026-11-09T00:00:00.000Z',
    method: { ...SUPPORT_METHOD },
    population: POPULATION,
    cost: COST,
    sample,
    excerpts: excerptsFor(sample.selected),
  })

  it('holds only an id and the two excerpts per item, and nothing about the judge', () => {
    const text = JSON.stringify(files.blind)
    expect(Object.keys(files.blind).sort()).toEqual(['format', 'instructions', 'items', 'orgId', 'sampleId', 'version'])
    for (const item of files.blind.items) expect(Object.keys(item).sort()).toEqual(['claim', 'id', 'passage'])
    // Planted markers: every fact about the judge or the row carries one, and none may leak.
    expect(text).not.toMatch(/MARKER/)
    for (const c of sample.selected) {
      for (const n of [c.articleFindingId, c.assessmentId]) expect(text).not.toContain(String(n))
    }
    for (const word of ['supports', 'partial', 'contradicts', 'inconclusive', 'supporting', 'no_support', 'not_assessed', 'confidence', 'judge', 'label"', 'shared_support', 'single_source', 'multi_source', 'similarity']) {
      expect(text).not.toContain(word)
    }
  })

  it('puts every judge fact in the key, and no excerpt text there', () => {
    const keyText = JSON.stringify(files.key)
    expect(keyText).not.toMatch(/sentence number/)
    expect(files.key.items).toHaveLength(20)
    expect(files.key.sampleId).toBe(files.blind.sampleId)
    const byId = new Map(files.key.items.map((i) => [i.id, i]))
    for (const item of files.blind.items) {
      const k = byId.get(item.id)!
      expect(item.claim).toBe(`Claim sentence number ${k.findingId}.`)
    }
  })

  it('refuses when a chosen finding has lost its text', () => {
    const excerpts = excerptsFor(sample.selected)
    excerpts.delete(sample.selected[3].findingId)
    expect(() =>
      buildShadowFiles({ orgId: 42, seed: 'blind', createdAt: 'now', method: { ...SUPPORT_METHOD }, population: POPULATION, cost: COST, sample, excerpts })
    ).toThrow(/1 chosen findings no longer have both excerpts/)
  })
})

// --- labels and the report --------------------------------------------------

function keyFrom(items: Array<Partial<ShadowKeyItem> & { judgeLabel: ShadowJudgeLabel }>, cost = COST): ShadowKey {
  return {
    format: 'source-support-shadow-key',
    version: 1,
    sampleId: 'sample-1',
    orgId: 7,
    seed: 's',
    createdAt: '2026-11-09T00:00:00.000Z',
    method: { ...SUPPORT_METHOD },
    strata: { supports: { population: 0, sampled: 0 }, partial: { population: 0, sampled: 0 }, contradicts: { population: 0, sampled: 0 }, inconclusive: { population: 0, sampled: 0 } },
    population: POPULATION,
    cost,
    items: items.map((x, i) => ({
      id: `item-${String(i + 1).padStart(3, '0')}`,
      findingId: i + 1,
      articleFindingId: x.articleFindingId ?? i + 1,
      assessmentId: x.assessmentId ?? i + 1,
      answerId: `answer-${i}`,
      surface: 'widget',
      articleSummary: x.judgeLabel === 'supports' ? 'supporting' : 'inconclusive',
      answerSummary: x.judgeLabel === 'supports' ? 'supporting' : 'inconclusive',
      caseType: 'single_source',
      ...x,
    })),
  }
}

const column = (labels: Array<HumanLabel | undefined>, over: Partial<LabelColumn> = {}): LabelColumn => ({
  reviewer: 'Owner',
  role: 'workspace_owner',
  labeledBlind: true,
  labels: new Map(labels.flatMap((l, i) => (l ? [[`item-${String(i + 1).padStart(3, '0')}`, l] as [string, HumanLabel]] : []))),
  ...over,
})

describe('label validation', () => {
  const key = keyFrom([{ judgeLabel: 'supports' }, { judgeLabel: 'partial' }, { judgeLabel: 'supports' }])
  const valid = {
    format: 'source-support-shadow-labels',
    version: 1,
    sampleId: 'sample-1',
    reviewer: { name: 'Owner', role: 'workspace_owner', labeledBlind: true },
    labels: [
      { item: 'item-001', label: 'supports' },
      { item: 'item-002', label: 'none', note: 'unrelated' },
      { item: 'item-003', label: null },
    ],
  }
  const problems = (raw: unknown) => {
    try {
      validateLabelsFile(raw, key)
      return []
    } catch (e) {
      expect(e).toBeInstanceOf(ShadowLabelError)
      return (e as ShadowLabelError).problems
    }
  }

  it('accepts a valid file and skips null labels', () => {
    const [col] = validateLabelsFile(valid, key)
    expect([...col.labels.entries()]).toEqual([
      ['item-001', 'supports'],
      ['item-002', 'none'],
    ])
  })

  it('refuses a role other than the owner or an approved maintainer, and a placeholder name', () => {
    expect(SHADOW_LABELER_ROLES).toEqual(['workspace_owner', 'approved_maintainer'])
    expect(problems({ ...valid, reviewer: { name: 'Someone', role: 'support_agent', labeledBlind: true } }).join()).toMatch(/role must be one of/)
    expect(problems({ ...valid, reviewer: { name: '<your name>', role: 'workspace_owner', labeledBlind: true } }).join()).toMatch(/name/)
    expect(problems({ ...valid, reviewer: { name: 'Owner', role: 'workspace_owner' } }).join()).toMatch(/labeledBlind/)
  })

  it('refuses unknown or repeated items, unknown labels, another sample, and a second column with no second reviewer', () => {
    expect(problems({ ...valid, sampleId: 'other' }).join()).toMatch(/different sample/)
    expect(problems({ ...valid, sampleId: '<sampleId from the labeling file>' }).join()).toMatch(/copied/)
    expect(problems({ ...valid, labels: [{ item: 'item-999', label: 'supports' }] }).join()).toMatch(/not an item/)
    expect(problems({ ...valid, labels: [{ item: 'item-001', label: 'supports' }, { item: 'item-001', label: 'none' }] }).join()).toMatch(/twice/)
    expect(problems({ ...valid, labels: [{ item: 'item-001', label: 'supporting' }] }).join()).toMatch(/must be one of/)
    expect(problems({ ...valid, labels: [{ item: 'item-001', label: 'supports', secondLabel: 'none' }] }).join()).toMatch(/needs a secondReviewer/)
    expect(problems({ ...valid, format: 'x', version: 2 })).toHaveLength(2)
  })

  it('reads a second reviewer column, and refuses the same person twice or a third reviewer', () => {
    const cols = validateLabelsFile(
      {
        ...valid,
        secondReviewer: { name: 'Maintainer', role: 'approved_maintainer', labeledBlind: true },
        labels: [{ item: 'item-001', label: 'supports', secondLabel: 'partial' }],
      },
      key
    )
    expect(cols.map((c) => [c.reviewer, [...c.labels.values()]])).toEqual([
      ['Owner', ['supports']],
      ['Maintainer', ['partial']],
    ])
    expect(problems({ ...valid, secondReviewer: { name: 'Owner', role: 'approved_maintainer', labeledBlind: true } }).join()).toMatch(/different person/)
    expect(() => combineColumns([cols, [column([])]])).toThrow(/two reviewers; found 3/)
    expect(() => combineColumns([[column([])], [column([])]])).toThrow(/same reviewer/)
  })

  it('writes a template, prefilled from the labeling file when given', () => {
    expect(buildLabelTemplate().labels).toEqual([])
    const t = buildLabelTemplate({ sampleId: 'abc', items: [{ id: 'item-001', claim: 'c', passage: 'p' }] })
    expect(t).toMatchObject({ sampleId: 'abc', labels: [{ item: 'item-001', label: null }], reviewer: { labeledBlind: false } })
    expect(JSON.stringify(t)).not.toContain('"c"')
    // An untouched template is refused: a placeholder name and role.
    expect(problems({ ...t, sampleId: 'sample-1', labels: [] }).length).toBeGreaterThanOrEqual(2)
  })
})

describe('agreement between two reviewers', () => {
  const two = (pairs: Array<[string, string, number]>) => {
    const a = new Map<string, string>()
    const b = new Map<string, string>()
    let i = 0
    for (const [x, y, n] of pairs) {
      for (let k = 0; k < n; k++, i++) {
        a.set(`i${i}`, x)
        b.set(`i${i}`, y)
      }
    }
    return [a, b] as const
  }

  it('matches a hand-computed kappa', () => {
    // po = 35/50 = 0.7; pe = 0.5*0.6 + 0.5*0.4 = 0.5; kappa = 0.2 / 0.5 = 0.4
    const [a, b] = two([
      ['supports', 'supports', 20],
      ['supports', 'none', 5],
      ['none', 'supports', 10],
      ['none', 'none', 15],
    ])
    const r = agreementBetween(a, b)
    expect(r.both).toBe(50)
    expect(r.agreed).toBe(35)
    expect(r.percent).toBeCloseTo(0.7, 10)
    expect(r.kappa).toBeCloseTo(0.4, 10)
  })

  it('is 1 for perfect agreement over several labels, and undefined when there is nothing to compare or one label throughout', () => {
    const [a, b] = two([
      ['supports', 'supports', 3],
      ['partial', 'partial', 2],
    ])
    expect(agreementBetween(a, b).kappa).toBeCloseTo(1, 10)
    const [c, d] = two([['supports', 'supports', 4]])
    expect(agreementBetween(c, d)).toMatchObject({ percent: 1, kappa: null })
    expect(agreementBetween(new Map([['x', 'supports']]), new Map([['y', 'supports']]))).toEqual({ both: 0, agreed: 0, percent: null, kappa: null })
  })

  it('only compares items both reviewers labeled, and kappa can be negative', () => {
    const [a, b] = two([
      ['supports', 'none', 5],
      ['none', 'supports', 5],
    ])
    a.set('only-a', 'supports')
    const r = agreementBetween(a, b)
    expect(r.both).toBe(10)
    expect(r.kappa).toBeCloseTo(-1, 10)
  })
})

describe('the report', () => {
  // 10 items. Judge supports x5 (person: supports x4, partial x1), judge partial x3
  // (person: partial x2, supports x1), judge inconclusive x2 (person: inconclusive, supports).
  const judge: ShadowJudgeLabel[] = ['supports', 'supports', 'supports', 'supports', 'supports', 'partial', 'partial', 'partial', 'inconclusive', 'inconclusive']
  const human: HumanLabel[] = ['supports', 'supports', 'supports', 'supports', 'partial', 'partial', 'partial', 'supports', 'inconclusive', 'supports']
  const key = keyFrom(judge.map((judgeLabel, i) => ({ judgeLabel, caseType: i % 2 === 0 ? 'single_source' : 'multi_source' })))
  const report = buildShadowReport(key, [column(human)])

  it('computes precision and recall per label as worked by hand', () => {
    expect(report.perLabel.supports).toEqual({ predicted: 5, actual: 6, truePositives: 4, precision: 0.8, recall: 4 / 6 })
    expect(report.perLabel.partial).toEqual({ predicted: 3, actual: 3, truePositives: 2, precision: 2 / 3, recall: 2 / 3 })
    expect(report.perLabel.inconclusive).toEqual({ predicted: 2, actual: 1, truePositives: 1, precision: 0.5, recall: 1 })
    expect(report.perLabel.contradicts).toEqual({ predicted: 0, actual: 0, truePositives: 0, precision: null, recall: null })
    expect(report.supporting.findings).toEqual({ predicted: 5, confirmed: 4, precision: 0.8 })
    expect(report.falseNegative).toEqual({ humanSupports: 6, missed: 2, rate: 2 / 6 })
    expect(report.labeled).toBe(10)
  })

  it('lists disagreements by case type, with ids and labels only', () => {
    expect(report.disagreements).toEqual({
      single_source: [{ item: 'item-005', judge: 'supports', human: 'partial' }],
      multi_source: [
        { item: 'item-008', judge: 'partial', human: 'supports' },
        { item: 'item-010', judge: 'inconclusive', human: 'supports' },
      ],
    })
  })

  it('never counts an abstention as supporting', () => {
    // Judge inconclusive and a person says supports: a miss, never a supporting prediction.
    expect(report.supporting.findings.predicted).toBe(5)
    expect(report.abstention.sample).toEqual({ judgeInconclusive: 2, labeledJudgeInconclusive: 2, countedAsSupporting: 0 })
    expect(SHADOW_ABSTENTION_RULE).toMatch(/never counted as supporting/)

    // A supports finding whose article or answer is not supporting is kept out of
    // the supporting sets, and the abstention target fails until it is explained.
    const odd = keyFrom([
      { judgeLabel: 'supports' },
      { judgeLabel: 'supports', articleSummary: 'inconclusive' },
      { judgeLabel: 'supports', answerSummary: 'not_assessed' },
    ])
    const r = buildShadowReport(odd, [column(['supports', 'supports', 'supports'])])
    expect(r.supporting.findings).toEqual({ predicted: 1, confirmed: 1, precision: 1 })
    expect(r.abstention.sample.countedAsSupporting).toBe(2)
    expect(r.verdict.checks.find((c) => c.target === 'abstention')!.met).toBe(false)
  })

  it('measures articles and answers as supporting when any of their supports findings is confirmed', () => {
    const k = keyFrom([
      { judgeLabel: 'supports', articleFindingId: 1, assessmentId: 1 },
      { judgeLabel: 'supports', articleFindingId: 1, assessmentId: 1 },
      { judgeLabel: 'supports', articleFindingId: 2, assessmentId: 1 },
      { judgeLabel: 'supports', articleFindingId: 3, assessmentId: 2 },
    ])
    const r = buildShadowReport(k, [column(['none', 'supports', 'none', 'partial'])])
    expect(r.supporting.findings).toEqual({ predicted: 4, confirmed: 1, precision: 0.25 })
    expect(r.supporting.articles).toEqual({ predicted: 3, confirmed: 1, precision: 1 / 3 })
    expect(r.supporting.answers).toEqual({ predicted: 2, confirmed: 1, precision: 0.5 })
  })

  it('with two reviewers, reports agreement and leaves their disagreements out until resolved', () => {
    const k = keyFrom([{ judgeLabel: 'supports' }, { judgeLabel: 'supports' }, { judgeLabel: 'partial' }, { judgeLabel: 'partial' }])
    const r = buildShadowReport(k, [
      column(['supports', 'supports', 'partial', undefined]),
      column(['supports', 'none', 'partial', 'partial'], { reviewer: 'Maintainer', role: 'approved_maintainer' }),
    ])
    expect(r.unresolved).toEqual(['item-002'])
    expect(r.labeled).toBe(3)
    expect(r.agreement).toMatchObject({ reviewers: ['Owner', 'Maintainer'], both: 3, agreed: 2 })
    expect(r.agreement!.disagreements).toEqual({ single_source: [{ item: 'item-002', first: 'supports', second: 'none' }] })
  })

  it('prints no excerpt and no note, and ends with the verdict', () => {
    const text = formatShadowReport(report)
    expect(text).not.toMatch(/sentence number|unrelated/)
    expect(text.trim().split('\n').slice(-1)[0]).toMatch(/Nothing from this run may be presented as a measured accuracy/)
    expect(text).toMatch(/VERDICT: NO-GO/)
    expect(text).toMatch(/need 190 more labels \(have 10 of 200\)/)
  })
})

describe('the verdict', () => {
  const passing = (over: Partial<VerdictInput> = {}): VerdictInput => ({
    labeled: 200,
    supporting: {
      findings: { predicted: 100, confirmed: 90, precision: 0.9 },
      articles: { predicted: 50, confirmed: 45, precision: 0.9 },
      answers: { predicted: 40, confirmed: 36, precision: 0.9 },
    },
    falseNegative: { humanSupports: 100, missed: 30, rate: 0.3 },
    cost: { ceilingMicros: 3000, priced: 10, unpriced: 0, meanMicros: 3000, maxMicros: 3000, overCeiling: 0 },
    reviewers: [{ name: 'Owner', role: 'workspace_owner', labeledBlind: true, labeled: 200 }],
    abstention: { sample: { countedAsSupporting: 0 } },
    ...over,
  })

  it('pins the owner-approved targets', () => {
    expect(SHADOW_TARGETS).toEqual({ supportingPrecision: 0.9, minLabeledPairs: 200, maxFalseNegativeRate: 0.3, costCeilingMicros: 3000 })
    expect(SHADOW_TARGETS.costCeilingMicros).toBe(SUPPORT_COST_CEILING_MICROS)
    expect(Object.isFrozen(SHADOW_TARGETS)).toBe(true)
    // The floor stays provisional until a go decision is recorded.
    expect(SUPPORT_METHOD.floorCalibrated).toBe(false)
  })

  it('is GO at exactly every threshold with enough samples', () => {
    const v = decideVerdict(passing())
    expect(v.decision).toBe('GO')
    expect(v.missing).toEqual([])
    expect(v.checks.every((c) => c.met)).toBe(true)
  })

  it('is NO-GO below the minimum sample, even with perfect precision', () => {
    const perfect = { predicted: 199, confirmed: 199, precision: 1 }
    const v = decideVerdict(passing({ labeled: 199, supporting: { findings: perfect, articles: perfect, answers: perfect }, falseNegative: { humanSupports: 199, missed: 0, rate: 0 } }))
    expect(v.decision).toBe('NO-GO')
    expect(v.missing).toEqual(['need 1 more labels (have 199 of 200)'])
  })

  it('is NO-GO at 0.89 precision, and just under the threshold, for findings, articles and answers', () => {
    expect(decideVerdict(passing({ supporting: { ...passing().supporting, findings: { predicted: 100, confirmed: 89, precision: 0.89 } } })).missing).toEqual([
      'supports findings precision 0.890 below 0.90',
    ])
    const justUnder = decideVerdict(passing({ supporting: { ...passing().supporting, findings: { predicted: 10_000, confirmed: 8_999, precision: 0.8999 } } }))
    expect(justUnder.decision).toBe('NO-GO')
    expect(justUnder.missing[0]).toBe('supports findings precision 0.899 below 0.90')
    expect(decideVerdict(passing({ supporting: { ...passing().supporting, articles: { predicted: 50, confirmed: 44, precision: 0.88 } } })).missing).toEqual([
      'supporting articles precision 0.880 below 0.90',
    ])
    expect(decideVerdict(passing({ supporting: { ...passing().supporting, answers: { predicted: 0, confirmed: 0, precision: null } } })).decision).toBe('NO-GO')
  })

  it('is NO-GO just over the tolerated false-negative rate, or when it cannot be measured', () => {
    expect(decideVerdict(passing({ falseNegative: { humanSupports: 100, missed: 31, rate: 0.31 } })).missing).toEqual(['false-negative rate 0.310 above 0.30'])
    expect(decideVerdict(passing({ falseNegative: { humanSupports: 1000, missed: 301, rate: 0.301 } })).decision).toBe('NO-GO')
    expect(decideVerdict(passing({ falseNegative: { humanSupports: 0, missed: 0, rate: null } })).decision).toBe('NO-GO')
  })

  it('is NO-GO when any answer is over the cost ceiling, or no cost is known', () => {
    expect(decideVerdict(passing({ cost: { ...passing().cost, maxMicros: 3001, overCeiling: 1 } })).missing[0]).toMatch(/1 answers cost more than the 3000 micro-dollar ceiling/)
    expect(decideVerdict(passing({ cost: { ...passing().cost, priced: 0, unpriced: 5, meanMicros: null, maxMicros: null } })).missing[0]).toMatch(/cannot be checked/)
  })

  it('is NO-GO when a reviewer did not confirm labeling blind, or there is no reviewer', () => {
    expect(decideVerdict(passing({ reviewers: [{ name: 'Owner', role: 'workspace_owner', labeledBlind: false, labeled: 200 }] })).missing[0]).toMatch(/Owner did not confirm/)
    expect(decideVerdict(passing({ reviewers: [] })).decision).toBe('NO-GO')
  })

  it('never says GO without human labels', () => {
    const k = keyFrom(Array.from({ length: 250 }, () => ({ judgeLabel: 'supports' as const })))
    const r = buildShadowReport(k, [column([])])
    expect(r.labeled).toBe(0)
    expect(r.verdict.decision).toBe('NO-GO')
    expect(r.verdict.missing).toContain('need 200 more labels (have 0 of 200)')
  })

  it('is GO end to end on 200 confirmed labels within budget, and NO-GO on 199', () => {
    const judge = [...Array<ShadowJudgeLabel>(180).fill('supports'), ...Array<ShadowJudgeLabel>(20).fill('partial')]
    // 162 of 180 supports confirmed (precision 0.90). A person also says supports for
    // 18 of the 20 partials, so 18 of 180 human supports were missed (rate 0.10).
    const human: HumanLabel[] = [...Array<HumanLabel>(162).fill('supports'), ...Array<HumanLabel>(18).fill('partial'), ...Array<HumanLabel>(18).fill('supports'), 'partial', 'partial']
    const r = buildShadowReport(keyFrom(judge.map((judgeLabel) => ({ judgeLabel }))), [column(human)])
    expect(r.supporting.findings.precision).toBeCloseTo(0.9, 12)
    expect(r.verdict.decision).toBe('GO')
    expect(formatShadowReport(r)).toMatch(/VERDICT: GO\. Every target is met on 200 human-labeled pairs/)

    const fewer = buildShadowReport(keyFrom(judge.map((judgeLabel) => ({ judgeLabel }))), [column([...human.slice(0, 199), undefined])])
    expect(fewer.labeled).toBe(199)
    expect(fewer.verdict.decision).toBe('NO-GO')
  })
})

describe('cost per answer', () => {
  it('summarizes priced and unpriced assessments against the ceiling', () => {
    const price = (u: { judgeInputTokens: number }, model: string) => (model === 'priced' ? u.judgeInputTokens : null)
    const s = summarizeCost(
      [
        { judgeModel: 'priced', judgeInputTokens: 1000, judgeOutputTokens: 0, embeddingTokens: 0, count: 3 },
        { judgeModel: 'priced', judgeInputTokens: 4000, judgeOutputTokens: 0, embeddingTokens: 0, count: 1 },
        { judgeModel: 'own-model', judgeInputTokens: 9, judgeOutputTokens: 0, embeddingTokens: 0, count: 2 },
        { judgeModel: null, judgeInputTokens: 9, judgeOutputTokens: 0, embeddingTokens: 0, count: 1 },
      ],
      price,
      3000
    )
    expect(s).toEqual({ ceilingMicros: 3000, priced: 4, unpriced: 3, meanMicros: 1750, maxMicros: 4000, overCeiling: 1 })
    expect(summarizeCost([], price)).toEqual({ ceilingMicros: 3000, priced: 0, unpriced: 0, meanMicros: null, maxMicros: null, overCeiling: 0 })
  })
})
