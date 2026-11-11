import { createHash } from 'node:crypto'
import { labelMetrics, ratio, type LabelMetrics } from './eval'
import type { SupportSummary } from './summary'
import { SHADOW_LABELER_ROLES, SHADOW_TARGETS, type ShadowLabelerRole } from './targets'

/**
 * The shadow run and its go/no-go gate (#446). Findings from opted-in
 * workspaces are stored but shown to no one; a workspace owner or an approved
 * maintainer labels a sample of them without seeing the judge's label first,
 * and the report compares the two against `SHADOW_TARGETS`.
 *
 * Everything here is pure: no database, no filesystem, no model. The unit of
 * labeling is one stored claim finding, the pair of an answer sentence (the
 * claim excerpt) and an article sentence (the passage excerpt) the judge tied
 * together. A claim/article pair the judge returned as `none` has no row and
 * no excerpt, so it cannot be sampled: the false-negative rate is measured
 * over stored findings only.
 *
 * Excerpt text only ever goes into the labeling file. The key, the labels and
 * the report carry ids and enum labels, never text.
 */

/** The labels a stored claim finding can carry: what the judge kept after the similarity check. */
export const SHADOW_JUDGE_LABELS = ['supports', 'partial', 'contradicts', 'inconclusive'] as const
export type ShadowJudgeLabel = (typeof SHADOW_JUDGE_LABELS)[number]

/** What a person may say about one pair. `inconclusive` is "cannot tell from these two sentences". */
export const HUMAN_LABELS = ['supports', 'partial', 'contradicts', 'none', 'inconclusive'] as const
export type HumanLabel = (typeof HUMAN_LABELS)[number]

/**
 * The kind of answer a finding came from, derived from the stored rows (real
 * answers have no hand-written case type), so disagreements can be grouped.
 */
export const SHADOW_CASE_TYPES = ['shared_support', 'contradiction_in_answer', 'multi_source', 'single_source'] as const
export type ShadowCaseType = (typeof SHADOW_CASE_TYPES)[number]

export type ArticleSummaryState = 'supporting' | 'no_support' | 'inconclusive'

/** One stored claim finding with excerpts available, as the pool query returns it. No text. */
export interface ShadowCandidate {
  findingId: number
  articleFindingId: number
  assessmentId: number
  answerId: string
  surface: string
  judgeLabel: ShadowJudgeLabel
  articleSummary: ArticleSummaryState
  answerSummary: SupportSummary
  /** How many other supplied articles carry the same support for a claim. */
  sharedWithCount: number
  /** How many article findings the answer's assessment has. */
  articleFindingsInAnswer: number
  /** Whether any claim finding of the same answer is `contradicts`. */
  answerHasContradiction: boolean
}

/** Counts for the whole workspace under one method version, for the abstention lines. */
export interface ShadowPopulation {
  assessments: { completed: number; failed: number; skipped: number }
  answers: Record<SupportSummary, number>
  articles: Record<ArticleSummaryState, number>
  /** Every stored claim finding by label, with or without excerpts. */
  claimFindings: Record<ShadowJudgeLabel, number>
}

export interface CostSummary {
  ceilingMicros: number
  /** Completed assessments with a known price. */
  priced: number
  /** Completed assessments whose model has no listed price, so their cost is unknown. */
  unpriced: number
  meanMicros: number | null
  maxMicros: number | null
  overCeiling: number
}

export interface ShadowMethod {
  method: string
  version: number
  rubric: number
  similarityFloor: number
  floorCalibrated: boolean
}

export interface ShadowKeyItem {
  id: string
  findingId: number
  articleFindingId: number
  assessmentId: number
  answerId: string
  surface: string
  judgeLabel: ShadowJudgeLabel
  articleSummary: ArticleSummaryState
  answerSummary: SupportSummary
  caseType: ShadowCaseType
}

/** The sidecar that maps each item to what the judge said. Kept apart from the labeling file. */
export interface ShadowKey {
  format: 'source-support-shadow-key'
  version: 1
  sampleId: string
  orgId: number
  seed: string
  createdAt: string
  method: ShadowMethod
  strata: Record<ShadowJudgeLabel, { population: number; sampled: number }>
  population: ShadowPopulation
  cost: CostSummary
  items: ShadowKeyItem[]
}

/** What the labeler reads: ids and the two excerpts, nothing about the judge. */
export interface BlindLabelingFile {
  format: 'source-support-shadow-labeling'
  version: 1
  sampleId: string
  orgId: number
  instructions: string[]
  items: Array<{ id: string; claim: string; passage: string }>
}

export class ShadowSampleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShadowSampleError'
  }
}

export class ShadowLabelError extends Error {
  constructor(public readonly problems: string[]) {
    super(`The labels file is not valid:\n  - ${problems.join('\n  - ')}`)
    this.name = 'ShadowLabelError'
  }
}

// --- sampling ---------------------------------------------------------------

/** FNV-1a, 32-bit: a stable number from a string, to seed the generator. */
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** mulberry32: small, deterministic, good enough to shuffle a sample. */
function generator(seed: string): () => number {
  let a = hashString(seed)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A Fisher-Yates shuffle driven by the seed. The input is never changed. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items]
  const next = generator(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * How many items each stratum gets: proportional to its size (largest
 * remainder), so pooled figures such as the false-negative rate are not skewed
 * by the sampling, and every non-empty stratum gets at least one when there is
 * room for one each.
 */
export function allocateStrata<K extends string>(sizes: Record<K, number>, n: number, order: readonly K[]): Record<K, number> {
  const total = order.reduce((s, k) => s + sizes[k], 0)
  if (!Number.isInteger(n) || n < 1) throw new ShadowSampleError('The sample size must be a whole number of at least 1')
  if (n > total) throw new ShadowSampleError(`Only ${total} findings with stored excerpts exist; ${n} were requested`)

  const alloc = {} as Record<K, number>
  const remainders: Array<{ k: K; r: number }> = []
  for (const k of order) {
    const exact = (n * sizes[k]) / total
    alloc[k] = Math.floor(exact)
    remainders.push({ k, r: exact - alloc[k] })
  }
  let left = n - order.reduce((s, k) => s + alloc[k], 0)
  remainders.sort((a, b) => b.r - a.r || order.indexOf(a.k) - order.indexOf(b.k))
  for (const { k } of remainders) {
    if (left === 0) break
    if (alloc[k] < sizes[k]) {
      alloc[k]++
      left--
    }
  }

  const nonEmpty = order.filter((k) => sizes[k] > 0)
  if (n >= nonEmpty.length) {
    for (const k of nonEmpty) {
      if (alloc[k] > 0) continue
      const donor = [...nonEmpty].sort((a, b) => alloc[b] - alloc[a] || order.indexOf(a) - order.indexOf(b))[0]
      if (alloc[donor] > 1) {
        alloc[donor]--
        alloc[k]++
      }
    }
  }
  return alloc
}

export function caseTypeFor(c: Pick<ShadowCandidate, 'sharedWithCount' | 'answerHasContradiction' | 'articleFindingsInAnswer'>): ShadowCaseType {
  if (c.sharedWithCount > 0) return 'shared_support'
  if (c.answerHasContradiction) return 'contradiction_in_answer'
  if (c.articleFindingsInAnswer > 1) return 'multi_source'
  return 'single_source'
}

export interface StratifiedSample {
  /** The chosen findings, in the order the labeler will see them (shuffled across strata). */
  selected: ShadowCandidate[]
  strata: Record<ShadowJudgeLabel, { population: number; sampled: number }>
}

/**
 * Draws a deterministic sample stratified by the judge's label. The same pool,
 * size and seed always give the same sample, whatever order the database
 * returned the rows in. The final order mixes the strata, so the position of
 * an item says nothing about its label.
 */
export function drawStratifiedSample(candidates: readonly ShadowCandidate[], size: number, seed: string): StratifiedSample {
  const ids = new Set<number>()
  for (const c of candidates) {
    if (!(SHADOW_JUDGE_LABELS as readonly string[]).includes(c.judgeLabel)) throw new ShadowSampleError(`Finding ${c.findingId} has an unknown label`)
    if (ids.has(c.findingId)) throw new ShadowSampleError(`Finding ${c.findingId} appears twice in the pool`)
    ids.add(c.findingId)
  }
  const byLabel = Object.fromEntries(
    SHADOW_JUDGE_LABELS.map((l) => [l, candidates.filter((c) => c.judgeLabel === l).sort((a, b) => a.findingId - b.findingId)])
  ) as Record<ShadowJudgeLabel, ShadowCandidate[]>
  const sizes = Object.fromEntries(SHADOW_JUDGE_LABELS.map((l) => [l, byLabel[l].length])) as Record<ShadowJudgeLabel, number>
  const alloc = allocateStrata(sizes, size, SHADOW_JUDGE_LABELS)

  const chosen = SHADOW_JUDGE_LABELS.flatMap((l) => seededShuffle(byLabel[l], `${seed}:stratum:${l}`).slice(0, alloc[l]))
  const selected = seededShuffle(
    chosen.sort((a, b) => a.findingId - b.findingId),
    `${seed}:order`
  )
  const strata = Object.fromEntries(SHADOW_JUDGE_LABELS.map((l) => [l, { population: sizes[l], sampled: alloc[l] }])) as StratifiedSample['strata']
  return { selected, strata }
}

/** Ties a labels file to the sample it was written for, without revealing anything about it. */
export function sampleIdFor(orgId: number, seed: string, findingIds: readonly number[]): string {
  const body = `${orgId}|${seed}|${[...findingIds].sort((a, b) => a - b).join(',')}`
  return createHash('sha256').update(body).digest('hex').slice(0, 16)
}

export const BLIND_INSTRUCTIONS: readonly string[] = Object.freeze([
  'Each item is one sentence from an answer (claim) and one sentence from a knowledge-base article (passage).',
  'Record your judgment for each item id in a labels file (pnpm support:shadow template --sample=<this file> --out=<labels.json>).',
  'Do not open the key file, a report or any stored finding before every label is written.',
  'Only the workspace owner or an approved maintainer may read and label these excerpts. Do not copy them anywhere else.',
])

export interface BuildShadowFilesInput {
  orgId: number
  seed: string
  createdAt: string
  method: ShadowMethod
  population: ShadowPopulation
  cost: CostSummary
  sample: StratifiedSample
  /** The excerpt text for each chosen finding id. */
  excerpts: ReadonlyMap<number, { claim: string; passage: string }>
}

/**
 * Builds the blind labeling file and its key. The labeling file holds only an
 * item id and the two excerpts per item; every fact about the judge (label,
 * state, finding ids, case type) is in the key. Refuses when any chosen
 * finding has lost its text.
 */
export function buildShadowFiles(input: BuildShadowFilesInput): { blind: BlindLabelingFile; key: ShadowKey } {
  const { selected } = input.sample
  const missing = selected.filter((c) => {
    const e = input.excerpts.get(c.findingId)
    return !e || !e.claim || !e.passage
  })
  if (missing.length > 0) {
    throw new ShadowSampleError(`${missing.length} chosen findings no longer have both excerpts (expired or removed); run the sample again`)
  }
  const width = Math.max(3, String(selected.length).length)
  const sampleId = sampleIdFor(input.orgId, input.seed, selected.map((c) => c.findingId))
  const items = selected.map((c, i) => ({ id: `item-${String(i + 1).padStart(width, '0')}`, c }))

  const blind: BlindLabelingFile = {
    format: 'source-support-shadow-labeling',
    version: 1,
    sampleId,
    orgId: input.orgId,
    instructions: [...BLIND_INSTRUCTIONS],
    items: items.map(({ id, c }) => {
      const e = input.excerpts.get(c.findingId)!
      return { id, claim: e.claim, passage: e.passage }
    }),
  }
  const key: ShadowKey = {
    format: 'source-support-shadow-key',
    version: 1,
    sampleId,
    orgId: input.orgId,
    seed: input.seed,
    createdAt: input.createdAt,
    method: { ...input.method },
    strata: input.sample.strata,
    population: input.population,
    cost: input.cost,
    items: items.map(({ id, c }) => ({
      id,
      findingId: c.findingId,
      articleFindingId: c.articleFindingId,
      assessmentId: c.assessmentId,
      answerId: c.answerId,
      surface: c.surface,
      judgeLabel: c.judgeLabel,
      articleSummary: c.articleSummary,
      answerSummary: c.answerSummary,
      caseType: caseTypeFor(c),
    })),
  }
  return { blind, key }
}

// --- cost -------------------------------------------------------------------

export interface CostRow {
  judgeModel: string | null
  judgeInputTokens: number
  judgeOutputTokens: number
  embeddingTokens: number
  /** How many completed assessments had exactly this usage. */
  count: number
}

/** Per-answer cost of the completed assessments against the ceiling. `price` returns null for a model with no listed price. */
export function summarizeCost(
  rows: readonly CostRow[],
  price: (usage: { judgeInputTokens: number; judgeOutputTokens: number; embeddingTokens: number }, judgeModel: string) => number | null,
  ceilingMicros: number = SHADOW_TARGETS.costCeilingMicros
): CostSummary {
  let priced = 0
  let unpriced = 0
  let total = 0
  let max: number | null = null
  let over = 0
  for (const r of rows) {
    const cost = r.judgeModel ? price(r, r.judgeModel) : null
    if (cost === null) {
      unpriced += r.count
      continue
    }
    priced += r.count
    total += cost * r.count
    max = max === null ? cost : Math.max(max, cost)
    if (cost > ceilingMicros) over += r.count
  }
  return { ceilingMicros, priced, unpriced, meanMicros: priced === 0 ? null : total / priced, maxMicros: max, overCeiling: over }
}

// --- labels -----------------------------------------------------------------

export interface LabelReviewer {
  name: string
  role: ShadowLabelerRole
  /** The reviewer confirms every label was written before seeing the judge's. */
  labeledBlind: boolean
}

export interface LabelsFile {
  format: 'source-support-shadow-labels'
  version: 1
  sampleId: string
  instructions?: string[]
  reviewer: LabelReviewer
  /** An optional second reviewer, labeling in the `secondLabel` column. */
  secondReviewer?: LabelReviewer
  labels: Array<{ item: string; label: HumanLabel | null; secondLabel?: HumanLabel | null; note?: string }>
}

/** One reviewer's labels, by item id. Unlabeled items are absent. */
export interface LabelColumn {
  reviewer: string
  role: ShadowLabelerRole
  labeledBlind: boolean
  labels: Map<string, HumanLabel>
}

export const LABEL_INSTRUCTIONS: readonly string[] = Object.freeze([
  'Label every item from the labeling file only. Do not open the key file, a report or any stored finding until every label is written, then set labeledBlind to true.',
  'supports: the passage, on its own, says what the claim says.',
  'partial: the passage backs part of the claim but not all of it.',
  'contradicts: the passage says something incompatible with the claim.',
  'none: the passage is not about what the claim says.',
  'inconclusive: you cannot tell from these two sentences.',
  'Leave label as null to skip an item; a skipped item does not count toward the labeled sample.',
  'reviewer.role must be workspace_owner or approved_maintainer: no one else may label real customer excerpts.',
  'A second reviewer fills secondReviewer and the secondLabel column, or writes a separate labels file, without seeing the first reviewer\'s labels.',
  'Never copy excerpt text into a note.',
])

/** An empty labels file, prefilled with the sample's item ids when the labeling file is given. */
export function buildLabelTemplate(blind?: Pick<BlindLabelingFile, 'sampleId' | 'items'>): LabelsFile {
  return {
    format: 'source-support-shadow-labels',
    version: 1,
    sampleId: blind?.sampleId ?? '<sampleId from the labeling file>',
    instructions: [...LABEL_INSTRUCTIONS],
    reviewer: { name: '<your name>', role: '<workspace_owner or approved_maintainer>' as ShadowLabelerRole, labeledBlind: false },
    labels: (blind?.items ?? []).map((i) => ({ item: i.id, label: null })),
  }
}

const isPlaceholder = (s: string) => /^<.*>$/.test(s.trim())

function readReviewer(raw: unknown, where: string, problems: string[]): LabelReviewer | null {
  if (!raw || typeof raw !== 'object') {
    problems.push(`${where} must be an object with name, role and labeledBlind`)
    return null
  }
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (!name || isPlaceholder(name)) problems.push(`${where}.name must name the person who labeled`)
  if (!(SHADOW_LABELER_ROLES as readonly unknown[]).includes(r.role)) {
    problems.push(`${where}.role must be one of ${SHADOW_LABELER_ROLES.join(', ')}: only they may label real customer excerpts`)
  }
  if (typeof r.labeledBlind !== 'boolean') problems.push(`${where}.labeledBlind must be true or false`)
  return { name, role: r.role as ShadowLabelerRole, labeledBlind: r.labeledBlind === true }
}

function readLabel(value: unknown, where: string, problems: string[]): HumanLabel | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && (HUMAN_LABELS as readonly string[]).includes(value)) return value as HumanLabel
  problems.push(`${where} must be one of ${HUMAN_LABELS.join(', ')} or null`)
  return null
}

/**
 * Checks a labels file against the key and returns one column per reviewer.
 * Every problem is collected, and any problem refuses the whole file: a
 * report is never built on labels that were only partly understood.
 */
export function validateLabelsFile(raw: unknown, key: Pick<ShadowKey, 'sampleId' | 'items'>): LabelColumn[] {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object') throw new ShadowLabelError(['The labels file must be a JSON object'])
  const f = raw as Record<string, unknown>
  if (f.format !== 'source-support-shadow-labels') problems.push('format must be "source-support-shadow-labels"')
  if (f.version !== 1) problems.push('version must be 1')
  if (typeof f.sampleId !== 'string' || isPlaceholder(f.sampleId)) problems.push('sampleId must be copied from the labeling file')
  else if (f.sampleId !== key.sampleId) problems.push('sampleId does not match the key: these labels were written for a different sample')

  const first = readReviewer(f.reviewer, 'reviewer', problems)
  const second = f.secondReviewer === undefined || f.secondReviewer === null ? null : readReviewer(f.secondReviewer, 'secondReviewer', problems)
  if (first && second && first.name === second.name) problems.push('secondReviewer must be a different person from reviewer')

  const known = new Set(key.items.map((i) => i.id))
  const seen = new Set<string>()
  const a = new Map<string, HumanLabel>()
  const b = new Map<string, HumanLabel>()
  if (!Array.isArray(f.labels)) problems.push('labels must be a list')
  else {
    f.labels.forEach((entry, i) => {
      const where = `labels[${i}]`
      if (!entry || typeof entry !== 'object') {
        problems.push(`${where} must be an object`)
        return
      }
      const e = entry as Record<string, unknown>
      if (typeof e.item !== 'string' || !known.has(e.item)) {
        problems.push(`${where}.item is not an item of this sample`)
        return
      }
      if (seen.has(e.item)) {
        problems.push(`${where}.item ${e.item} is labeled twice`)
        return
      }
      seen.add(e.item)
      const label = readLabel(e.label, `${where}.label`, problems)
      if (label) a.set(e.item, label)
      if (e.secondLabel !== undefined && e.secondLabel !== null) {
        if (!second) problems.push(`${where}.secondLabel needs a secondReviewer`)
        const l2 = readLabel(e.secondLabel, `${where}.secondLabel`, problems)
        if (l2) b.set(e.item, l2)
      }
      if (e.note !== undefined && typeof e.note !== 'string') problems.push(`${where}.note must be text`)
    })
  }
  if (problems.length > 0) throw new ShadowLabelError(problems)

  const columns: LabelColumn[] = [{ reviewer: first!.name, role: first!.role, labeledBlind: first!.labeledBlind, labels: a }]
  if (second) columns.push({ reviewer: second.name, role: second.role, labeledBlind: second.labeledBlind, labels: b })
  return columns
}

/** Merges the columns of one or two labels files; more than two reviewers, or the same reviewer twice, is refused. */
export function combineColumns(files: readonly LabelColumn[][]): LabelColumn[] {
  const all = files.flat()
  if (all.length > 2) throw new ShadowLabelError([`Agreement is measured between two reviewers; found ${all.length}`])
  if (all.length === 2 && all[0].reviewer === all[1].reviewer) throw new ShadowLabelError(['The two labels files are from the same reviewer'])
  return all
}

// --- agreement --------------------------------------------------------------

export interface Agreement {
  /** Items both reviewers labeled. */
  both: number
  agreed: number
  percent: number | null
  /** Cohen's kappa, or null when it is undefined (nothing in common, or both used one same label throughout). */
  kappa: number | null
}

/** Percent agreement and Cohen's kappa between two reviewers, over the items both labeled. */
export function agreementBetween(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): Agreement {
  const items = [...a.keys()].filter((k) => b.has(k))
  const n = items.length
  if (n === 0) return { both: 0, agreed: 0, percent: null, kappa: null }
  const agreed = items.filter((k) => a.get(k) === b.get(k)).length
  const po = agreed / n
  const categories = new Set(items.flatMap((k) => [a.get(k)!, b.get(k)!]))
  let pe = 0
  for (const c of categories) {
    const pa = items.filter((k) => a.get(k) === c).length / n
    const pb = items.filter((k) => b.get(k) === c).length / n
    pe += pa * pb
  }
  const kappa = Math.abs(1 - pe) < 1e-12 ? null : (po - pe) / (1 - pe)
  return { both: n, agreed, percent: po, kappa }
}

// --- report and verdict -----------------------------------------------------

export interface SupportingPrecision {
  /** Units the judge called supporting that a person labeled. */
  predicted: number
  /** Of those, the ones a person confirms. */
  confirmed: number
  precision: number | null
}

export interface TargetCheck {
  target: 'labeled_sample' | 'supporting_precision' | 'article_precision' | 'answer_precision' | 'false_negative_rate' | 'abstention' | 'cost' | 'blind_labels'
  met: boolean
  detail: string
}

export interface ShadowVerdict {
  decision: 'GO' | 'NO-GO'
  checks: TargetCheck[]
  /** What stands between this run and a go, one line each. Empty on a go. */
  missing: string[]
}

export interface ShadowReport {
  sampleId: string
  orgId: number
  method: ShadowMethod
  targets: typeof SHADOW_TARGETS
  sampleSize: number
  labeled: number
  unlabeled: number
  /** Items two reviewers labeled differently; they need one agreed label before they count. */
  unresolved: string[]
  reviewers: Array<{ name: string; role: ShadowLabelerRole; labeledBlind: boolean; labeled: number }>
  perLabel: Record<ShadowJudgeLabel, LabelMetrics>
  /** Pairs a person labeled `none` or `inconclusive`, labels the judge's stored findings never carry or carry differently. */
  humanOnly: { none: number; inconclusive: number }
  supporting: { findings: SupportingPrecision; articles: SupportingPrecision; answers: SupportingPrecision }
  falseNegative: { humanSupports: number; missed: number; rate: number | null }
  abstention: {
    sample: { judgeInconclusive: number; labeledJudgeInconclusive: number; countedAsSupporting: number }
    population: ShadowPopulation
  }
  agreement: (Agreement & { reviewers: [string, string]; disagreements: Record<string, Array<{ item: string; first: HumanLabel; second: HumanLabel }>> }) | null
  /** Judge and person disagreeing, grouped by case type. Ids and labels only. */
  disagreements: Record<string, Array<{ item: string; judge: ShadowJudgeLabel; human: HumanLabel }>>
  cost: CostSummary
  verdict: ShadowVerdict
}

const EPS = 1e-9
const atLeast = (num: number, den: number, target: number) => den > 0 && num >= target * den - EPS
const atMost = (num: number, den: number, target: number) => den > 0 && num <= target * den + EPS
const down = (x: number) => (Math.floor(x * 1000 + EPS) / 1000).toFixed(3)
const up = (x: number) => (Math.ceil(x * 1000 - EPS) / 1000).toFixed(3)
const target2 = (x: number) => x.toFixed(2)

function precisionOver(units: Map<string | number, boolean>): SupportingPrecision {
  const predicted = units.size
  const confirmed = [...units.values()].filter(Boolean).length
  return { predicted, confirmed, precision: ratio(confirmed, predicted) }
}

/** What the verdict needs from a report. Separate so the thresholds can be tested on their own. */
export type VerdictInput = Pick<ShadowReport, 'labeled' | 'supporting' | 'falseNegative' | 'cost' | 'reviewers'> & {
  abstention: { sample: { countedAsSupporting: number } }
}

/**
 * GO only when every target is met on human labels: the minimum labeled
 * sample, the precision of supporting findings, articles and answers, the
 * false-negative rate, abstention, cost, and blind labeling. Otherwise NO-GO,
 * with exactly what is missing. A figure that cannot be measured is not met.
 */
export function decideVerdict(r: VerdictInput, targets: typeof SHADOW_TARGETS = SHADOW_TARGETS): ShadowVerdict {
  const checks: TargetCheck[] = []
  const missing: string[] = []
  const add = (target: TargetCheck['target'], met: boolean, detail: string, need?: string) => {
    checks.push({ target, met, detail })
    if (!met && need) missing.push(need)
  }

  const min = targets.minLabeledPairs
  add(
    'labeled_sample',
    r.labeled >= min,
    `${r.labeled} human-labeled pairs (minimum ${min})`,
    `need ${Math.max(0, min - r.labeled)} more labels (have ${r.labeled} of ${min})`
  )

  const p = targets.supportingPrecision
  const precision = (target: TargetCheck['target'], name: string, s: SupportingPrecision) => {
    if (s.predicted === 0) {
      add(target, false, `no ${name} labeled by a person`, `no ${name} has a human label, so its precision cannot be measured`)
      return
    }
    const met = atLeast(s.confirmed, s.predicted, p)
    add(
      target,
      met,
      `${name}: ${s.confirmed} of ${s.predicted} confirmed (precision ${down(s.precision!)}, target ${target2(p)})`,
      `${name} precision ${down(s.precision!)} below ${target2(p)}`
    )
  }
  precision('supporting_precision', 'supports findings', r.supporting.findings)
  precision('article_precision', 'supporting articles', r.supporting.articles)
  precision('answer_precision', 'supporting answers', r.supporting.answers)

  const fn = r.falseNegative
  const maxFn = targets.maxFalseNegativeRate
  if (fn.humanSupports === 0) {
    add('false_negative_rate', false, 'no pair a person labeled supports', 'no pair has a human supports label, so the false-negative rate cannot be measured')
  } else {
    add(
      'false_negative_rate',
      atMost(fn.missed, fn.humanSupports, maxFn),
      `${fn.missed} of ${fn.humanSupports} human supports not kept as supports (rate ${up(fn.rate!)}, tolerated up to ${target2(maxFn)})`,
      `false-negative rate ${up(fn.rate!)} above ${target2(maxFn)}`
    )
  }

  const leaked = r.abstention.sample.countedAsSupporting
  add(
    'abstention',
    leaked === 0,
    leaked === 0
      ? 'inconclusive and not assessed are never counted as supporting'
      : `${leaked} supports findings sit under an inconclusive or not-assessed state and were kept out`,
    `${leaked} supports findings sit under an inconclusive or not-assessed state; the stored rows disagree and need a look`
  )

  const c = r.cost
  if (c.priced === 0) {
    add('cost', false, 'no completed assessment has a known price', 'no priced assessment, so cost per answer cannot be checked against the ceiling')
  } else {
    const met = c.overCeiling === 0
    add(
      'cost',
      met,
      `${c.priced} priced answers, mean ${Math.round(c.meanMicros!)} and most ${Math.round(c.maxMicros!)} micro-dollars (ceiling ${c.ceilingMicros})` +
        (c.unpriced > 0 ? `; ${c.unpriced} with no listed price` : ''),
      `${c.overCeiling} answers cost more than the ${c.ceilingMicros} micro-dollar ceiling (most ${Math.round(c.maxMicros!)})`
    )
  }

  const unblind = r.reviewers.filter((x) => !x.labeledBlind).map((x) => x.name)
  add(
    'blind_labels',
    r.reviewers.length > 0 && unblind.length === 0,
    unblind.length === 0 ? 'every reviewer confirms labeling blind' : `not confirmed blind: ${unblind.join(', ')}`,
    r.reviewers.length === 0 ? 'no reviewer' : `${unblind.join(', ')} did not confirm labeling without seeing the judge's label`
  )

  const go = checks.every((x) => x.met)
  return { decision: go ? 'GO' : 'NO-GO', checks, missing: go ? [] : missing }
}

/**
 * Joins the labels with the key and measures the judge against them. The
 * reference label for an item is the one label it has, or the label both
 * reviewers agree on; an item they label differently is unresolved and does
 * not count until they agree.
 */
export function buildShadowReport(key: ShadowKey, columns: readonly LabelColumn[]): ShadowReport {
  if (columns.length === 0) throw new ShadowLabelError(['At least one labels file is needed'])
  if (columns.length > 2) throw new ShadowLabelError([`Agreement is measured between two reviewers; found ${columns.length}`])

  const reference = new Map<string, HumanLabel>()
  const unresolved: string[] = []
  for (const item of key.items) {
    const given = columns.map((c) => c.labels.get(item.id)).filter((l): l is HumanLabel => l !== undefined)
    if (given.length === 0) continue
    if (given.every((l) => l === given[0])) reference.set(item.id, given[0])
    else unresolved.push(item.id)
  }

  const labeledItems = key.items.filter((i) => reference.has(i.id))
  const pairs = labeledItems.map((i) => ({ predicted: i.judgeLabel as string, actual: reference.get(i.id)! as string }))
  const perLabel = labelMetrics(pairs, SHADOW_JUDGE_LABELS)

  // Only a finding the judge kept as `supports`, in an article and answer whose
  // stored state is `supporting`, counts as a supporting prediction. Inconclusive
  // findings, and articles or answers that are inconclusive or not assessed,
  // never enter these sets. A supports finding under an abstaining state would
  // mean the stored rows disagree with each other; it is kept out and counted,
  // and the abstention check fails until that is understood.
  const supportsItems = labeledItems.filter(
    (i) => i.judgeLabel === 'supports' && i.articleSummary === 'supporting' && i.answerSummary === 'supporting'
  )
  const countedAsSupporting = labeledItems.filter(
    (i) => i.judgeLabel === 'supports' && (i.articleSummary !== 'supporting' || i.answerSummary !== 'supporting')
  ).length
  const findings = new Map<string, boolean>(supportsItems.map((i) => [i.id, reference.get(i.id) === 'supports']))
  const articles = new Map<number, boolean>()
  const answers = new Map<number, boolean>()
  for (const i of supportsItems) {
    const ok = reference.get(i.id) === 'supports'
    articles.set(i.articleFindingId, (articles.get(i.articleFindingId) ?? false) || ok)
    answers.set(i.assessmentId, (answers.get(i.assessmentId) ?? false) || ok)
  }

  const humanSupports = labeledItems.filter((i) => reference.get(i.id) === 'supports')
  const missed = humanSupports.filter((i) => i.judgeLabel !== 'supports').length

  const disagreements: ShadowReport['disagreements'] = {}
  for (const i of labeledItems) {
    const human = reference.get(i.id)!
    if (human === i.judgeLabel) continue
    ;(disagreements[i.caseType] ??= []).push({ item: i.id, judge: i.judgeLabel, human })
  }

  let agreement: ShadowReport['agreement'] = null
  if (columns.length === 2) {
    const [a, b] = columns
    const byType: Record<string, Array<{ item: string; first: HumanLabel; second: HumanLabel }>> = {}
    for (const item of key.items) {
      const x = a.labels.get(item.id)
      const y = b.labels.get(item.id)
      if (x && y && x !== y) (byType[item.caseType] ??= []).push({ item: item.id, first: x, second: y })
    }
    agreement = { ...agreementBetween(a.labels, b.labels), reviewers: [a.reviewer, b.reviewer], disagreements: byType }
  }

  const base = {
    sampleId: key.sampleId,
    orgId: key.orgId,
    method: key.method,
    targets: SHADOW_TARGETS,
    sampleSize: key.items.length,
    labeled: labeledItems.length,
    unlabeled: key.items.length - labeledItems.length - unresolved.length,
    unresolved,
    reviewers: columns.map((c) => ({ name: c.reviewer, role: c.role, labeledBlind: c.labeledBlind, labeled: c.labels.size })),
    perLabel,
    humanOnly: {
      none: labeledItems.filter((i) => reference.get(i.id) === 'none').length,
      inconclusive: labeledItems.filter((i) => reference.get(i.id) === 'inconclusive').length,
    },
    supporting: { findings: precisionOver(findings), articles: precisionOver(articles), answers: precisionOver(answers) },
    falseNegative: { humanSupports: humanSupports.length, missed, rate: ratio(missed, humanSupports.length) },
    abstention: {
      sample: {
        judgeInconclusive: key.items.filter((i) => i.judgeLabel === 'inconclusive').length,
        labeledJudgeInconclusive: labeledItems.filter((i) => i.judgeLabel === 'inconclusive').length,
        countedAsSupporting,
      },
      population: key.population,
    },
    agreement,
    disagreements,
    cost: key.cost,
  }
  return { ...base, verdict: decideVerdict(base) }
}

const pct = (n: number | null) => (n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`)

/**
 * The report as text. It prints ids, labels and counts only: no excerpt, and
 * no reviewer note, ever reaches the terminal. It ends with the verdict.
 */
export function formatShadowReport(r: ShadowReport): string {
  const out: string[] = []
  out.push(
    `Source support shadow run, workspace ${r.orgId}, sample ${r.sampleId}`,
    `Method ${r.method.method} v${r.method.version} rubric ${r.method.rubric}, similarity floor ${r.method.similarityFloor}` +
      (r.method.floorCalibrated ? ' (calibrated)' : ' (provisional)'),
    `Reviewers: ${r.reviewers.map((x) => `${x.name} (${x.role}, ${x.labeled} labels${x.labeledBlind ? ', blind' : ', NOT confirmed blind'})`).join('; ')}`,
    `Sample: ${r.sampleSize} pairs, ${r.labeled} labeled, ${r.unlabeled} unlabeled, ${r.unresolved.length} unresolved between reviewers`,
    ''
  )

  out.push('Per label (judge vs person)', '  label         judge  person  precision  recall')
  for (const l of SHADOW_JUDGE_LABELS) {
    const m = r.perLabel[l]
    out.push(`  ${l.padEnd(12)} ${String(m.predicted).padStart(6)}  ${String(m.actual).padStart(6)}  ${pct(m.precision).padStart(9)}  ${pct(m.recall).padStart(6)}`)
  }
  out.push(`  A person said none for ${r.humanOnly.none} and could not tell for ${r.humanOnly.inconclusive}.`, '')

  const s = r.supporting
  out.push(
    'Supporting (only findings the judge kept as supports count)',
    `  findings: ${s.findings.confirmed}/${s.findings.predicted} (${pct(s.findings.precision)})`,
    `  articles: ${s.articles.confirmed}/${s.articles.predicted} (${pct(s.articles.precision)})`,
    `  answers:  ${s.answers.confirmed}/${s.answers.predicted} (${pct(s.answers.precision)})`,
    `False negatives: ${r.falseNegative.missed} of ${r.falseNegative.humanSupports} human supports (${pct(r.falseNegative.rate)}). ` +
      'Pairs the judge returned as none are not stored, so they are not in the sample.',
    ''
  )

  const pop = r.abstention.population
  out.push(
    'Abstention (never counted as supporting)',
    `  sample: ${r.abstention.sample.judgeInconclusive} judge inconclusive (${r.abstention.sample.labeledJudgeInconclusive} labeled)`,
    `  answers: ${pop.answers.inconclusive} inconclusive, ${pop.answers.not_assessed} not assessed ` +
      `(${pop.assessments.skipped} skipped, ${pop.assessments.failed} failed), ${pop.answers.supporting} supporting, ${pop.answers.no_support} no support`,
    `  articles: ${pop.articles.inconclusive} inconclusive, ${pop.articles.supporting} supporting, ${pop.articles.no_support} no support`,
    ''
  )

  if (r.agreement) {
    const a = r.agreement
    out.push(
      `Agreement between ${a.reviewers[0]} and ${a.reviewers[1]}: ${a.agreed}/${a.both} (${pct(a.percent)}), Cohen's kappa ${a.kappa === null ? 'n/a' : a.kappa.toFixed(3)}`
    )
    for (const [type, list] of Object.entries(a.disagreements)) {
      out.push(`  ${type}: ${list.map((d) => `${d.item} ${d.first}/${d.second}`).join(', ')}`)
    }
    out.push('')
  }

  const total = Object.values(r.disagreements).reduce((n, l) => n + l.length, 0)
  out.push(`Judge and person disagree on ${total} pairs`)
  for (const type of SHADOW_CASE_TYPES) {
    const list = r.disagreements[type]
    if (list?.length) out.push(`  ${type} (${list.length}): ${list.map((d) => `${d.item} judge ${d.judge}, person ${d.human}`).join('; ')}`)
  }
  out.push('')

  const c = r.cost
  out.push(
    c.priced === 0
      ? `Cost: no priced assessment (${c.unpriced} with no listed price); ceiling ${c.ceilingMicros} micro-dollars per answer`
      : `Cost per answer: mean ${Math.round(c.meanMicros!)}, most ${Math.round(c.maxMicros!)} micro-dollars, ${c.overCeiling} over the ${c.ceilingMicros} ceiling` +
          (c.unpriced > 0 ? `, ${c.unpriced} with no listed price` : ''),
    ''
  )

  out.push('Targets')
  for (const ch of r.verdict.checks) out.push(`  [${ch.met ? 'met' : 'NOT MET'}] ${ch.target}: ${ch.detail}`)
  out.push('')
  if (r.verdict.decision === 'GO') {
    out.push(
      `VERDICT: GO. Every target is met on ${r.labeled} human-labeled pairs from this sample.`,
      'Record the decision, then mark the similarity floor calibrated in a new method version before anything is shown to a customer.'
    )
  } else {
    out.push('VERDICT: NO-GO. Missing:')
    for (const m of r.verdict.missing) out.push(`  - ${m}`)
    out.push('Nothing from this run may be presented as a measured accuracy.')
  }
  return out.join('\n')
}
