import { z } from 'zod'
import { SUPPORT_LIMITS } from './limits'
import { articleOf, claimOf, passageOf, quoteOf, type SupportSnapshot } from './snapshot'

/** What a judge may say about one claim and one article. */
export const JUDGE_LABELS = ['supports', 'partial', 'contradicts', 'none'] as const
export type JudgeLabel = (typeof JUDGE_LABELS)[number]

/**
 * A label code assigns after the judge has spoken. `inconclusive` is never
 * accepted from a judge; it is what a `supports` becomes when a check code
 * runs afterwards (the similarity floor) does not back it up.
 */
export type FindingLabel = JudgeLabel | 'inconclusive'

const labelSchema = z.enum(JUDGE_LABELS)
const idSchema = z.number().int().positive()

/**
 * The only shape a judge may return: ids and enum labels. `strictObject`
 * rejects any extra field, so there is nowhere for free text, a confidence
 * number or a quote to ride in on.
 */
export const judgeOutputSchema = z.strictObject({
  findings: z
    .array(
      z.strictObject({
        claim: idSchema,
        article: idSchema,
        passage: idSchema.nullable(),
        label: labelSchema,
      })
    )
    .max(SUPPORT_LIMITS.maxClaims * SUPPORT_LIMITS.maxArticles),
  /** Articles that address none of the claims. They may omit their findings. */
  off_topic: z.array(idSchema).max(SUPPORT_LIMITS.maxArticles),
})

export type InvalidReason =
  | 'malformed'
  | 'unknown_claim'
  | 'unknown_article'
  | 'unknown_passage'
  | 'duplicate_finding'
  | 'duplicate_off_topic'
  | 'passage_required'
  | 'passage_not_allowed'
  | 'off_topic_with_findings'

/** One finding after validation. Every string in it was copied from the snapshot, never from the judge. */
export interface ValidatedFinding {
  claim: number
  article: number
  passage: number | null
  label: FindingLabel
  /** The claim as the snapshot holds it, cut to the quote limit. */
  claimQuote: string
  /** The passage as the snapshot holds it, cut to the quote limit. Null when the finding has no passage. */
  passageQuote: string | null
}

export type ValidationResult =
  /** There was no output at all (an error, a timeout, an empty completion). Nothing was judged. */
  | { ok: false; kind: 'no_result' }
  /** The judge answered but the answer cannot be used. Nothing in it is trusted. */
  | { ok: false; kind: 'invalid'; reasons: InvalidReason[] }
  | { ok: true; findings: ValidatedFinding[]; offTopic: number[] }

const REASON_ORDER: InvalidReason[] = [
  'malformed',
  'unknown_claim',
  'unknown_article',
  'unknown_passage',
  'duplicate_finding',
  'duplicate_off_topic',
  'passage_required',
  'passage_not_allowed',
  'off_topic_with_findings',
]

/**
 * Checks what a judge returned against the snapshot it was shown. Any problem
 * rejects the whole output, because a judge that cites an id it was never given
 * cannot be trusted about the ids it got right. The result is built only from
 * snapshot data: quotes are copied from the claim and passage the ids name.
 */
export function validateJudgeOutput(snapshot: SupportSnapshot, raw: unknown): ValidationResult {
  if (raw === null || raw === undefined) return { ok: false, kind: 'no_result' }

  const parsed = judgeOutputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, kind: 'invalid', reasons: ['malformed'] }

  const reasons = new Set<InvalidReason>()
  const seenPairs = new Set<string>()
  const findings: ValidatedFinding[] = []

  for (const f of parsed.data.findings) {
    const claim = claimOf(snapshot, f.claim)
    const article = articleOf(snapshot, f.article)
    if (!claim) reasons.add('unknown_claim')
    if (!article) reasons.add('unknown_article')

    const pair = `${f.article}:${f.claim}`
    if (seenPairs.has(pair)) reasons.add('duplicate_finding')
    seenPairs.add(pair)

    if (f.label === 'none' && f.passage !== null) reasons.add('passage_not_allowed')
    if (f.label !== 'none' && f.passage === null) reasons.add('passage_required')

    const passage = article && f.passage !== null ? passageOf(article, f.passage) : undefined
    if (article && f.passage !== null && !passage) reasons.add('unknown_passage')

    if (claim && article && (f.passage === null || passage)) {
      findings.push({
        claim: f.claim,
        article: f.article,
        passage: f.passage,
        label: f.label,
        claimQuote: quoteOf(claim),
        passageQuote: passage ? quoteOf(passage) : null,
      })
    }
  }

  const offTopic = new Set<number>()
  for (const id of parsed.data.off_topic) {
    if (!articleOf(snapshot, id)) reasons.add('unknown_article')
    if (offTopic.has(id)) reasons.add('duplicate_off_topic')
    offTopic.add(id)
  }
  // An article that addresses none of the claims cannot also support, partly
  // support or contradict one.
  for (const f of parsed.data.findings) {
    if (offTopic.has(f.article) && f.label !== 'none') reasons.add('off_topic_with_findings')
  }

  if (reasons.size > 0) {
    return { ok: false, kind: 'invalid', reasons: REASON_ORDER.filter((r) => reasons.has(r)) }
  }

  findings.sort((a, b) => a.article - b.article || a.claim - b.claim)
  return { ok: true, findings, offTopic: [...offTopic].sort((a, b) => a - b) }
}

/**
 * Lowers any `supports` finding that `keep` does not confirm to `inconclusive`.
 * This is how an independent check (the similarity floor) is applied: it can
 * only take support away, never add it.
 */
export function downgradeUnconfirmed(
  findings: readonly ValidatedFinding[],
  keep: (finding: ValidatedFinding) => boolean
): ValidatedFinding[] {
  return findings.map((f) => (f.label === 'supports' && !keep(f) ? { ...f, label: 'inconclusive' as const } : f))
}
