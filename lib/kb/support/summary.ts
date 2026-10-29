import { normalizeForHash } from '@/lib/kb/revision'
import type { Execution } from './state'
import type { SnapshotArticle, SupportSnapshot } from './snapshot'
import type { ValidatedFinding, ValidationResult } from './validate'

/**
 * What the evaluator concluded about one article for one answer. Exactly one of
 * these, never combined:
 * - `supporting`: some claim has supporting evidence in the article.
 * - `no_support`: every claim was checked and none is supported.
 * - `inconclusive`: the judge answered but the answer cannot settle it.
 * - `not_assessed`: nothing was judged (skipped, failed, over a cap).
 */
export type SupportSummary = 'supporting' | 'no_support' | 'inconclusive' | 'not_assessed'

/** Why an article with no supporting evidence has none. The reasons may overlap, and are never an outcome. */
export type NoSupportReason = 'off_topic' | 'redundant'

export interface ArticleSupport {
  articleId: number
  summary: SupportSummary
  /** Only for `no_support`. Fixed set; there is no "preferred" or "leaned on". */
  reasons: NoSupportReason[]
  /** Other articles carrying equivalent support for the same claim. Never attributes support to just one. */
  sharedWith: number[]
  /** The claim-by-claim detail. Contradictions live here, not in the summary. */
  findings: ValidatedFinding[]
}

export interface DeriveInput {
  execution: Execution
  /** Absent when nothing was judged. */
  validation?: ValidationResult
}

const passageText = (article: SnapshotArticle, index: number) => article.passages.find((p) => p.index === index)?.text ?? ''

/**
 * Turns a judge's validated output into one summary per supplied article.
 *
 * Failures only move downward. If the assessment did not complete, or the
 * judge returned nothing, every article is `not_assessed`. If the judge
 * answered but the answer was rejected, every article it was shown is
 * `inconclusive`. `no_support` needs a complete, valid answer that covered
 * every claim for the article, so a missing or cut-off answer can never produce it.
 *
 * Articles the snapshot left out are always `not_assessed`.
 */
export function deriveArticleSupport(snapshot: SupportSnapshot, input: DeriveInput): ArticleSupport[] {
  const omitted: ArticleSupport[] = snapshot.omittedArticleIds.map((articleId) => ({
    articleId,
    summary: 'not_assessed',
    reasons: [],
    sharedWith: [],
    findings: [],
  }))
  const blank = (article: SnapshotArticle, summary: SupportSummary): ArticleSupport => ({
    articleId: article.id,
    summary,
    reasons: [],
    sharedWith: [],
    findings: [],
  })

  const { execution, validation } = input
  // Nothing was judged, or there was nothing to judge: an answer with no claims
  // has nothing a judge could check, so it can never read as "no support".
  if (
    execution.state !== 'completed' ||
    !validation ||
    (!validation.ok && validation.kind === 'no_result') ||
    snapshot.claims.length === 0
  ) {
    return [...snapshot.articles.map((a) => blank(a, 'not_assessed')), ...omitted]
  }
  if (!validation.ok) {
    return [...snapshot.articles.map((a) => blank(a, 'inconclusive')), ...omitted]
  }

  const offTopic = new Set(validation.offTopic)
  const totalClaims = snapshot.claims.length

  // First pass: each article's own summary.
  const own = new Map<number, ArticleSupport>()
  for (const article of snapshot.articles) {
    const findings = validation.findings.filter((f) => f.article === article.id)
    const covered = new Set(findings.map((f) => f.claim))
    // An article flagged off topic may omit its findings: it addresses none of the claims.
    const complete = offTopic.has(article.id) || covered.size === totalClaims
    const labels = new Set(findings.map((f) => f.label))

    let summary: SupportSummary
    if (labels.has('supports')) summary = 'supporting'
    else if (labels.has('partial') || labels.has('inconclusive')) summary = 'inconclusive'
    else if (!complete) summary = 'inconclusive'
    else summary = 'no_support'

    own.set(article.id, {
      articleId: article.id,
      summary,
      reasons: summary === 'no_support' && offTopic.has(article.id) ? ['off_topic'] : [],
      sharedWith: [],
      findings,
    })
  }

  // Second pass: shared support. Two supporting articles whose supporting
  // passages for a claim read identically share it, so neither is "the" source.
  const shared = new Map<number, Set<number>>()
  const supporting = snapshot.articles.filter((a) => own.get(a.id)!.summary === 'supporting')
  for (const claim of snapshot.claims) {
    const holders = supporting.flatMap((article) => {
      const f = own.get(article.id)!.findings.find((x) => x.claim === claim.index && x.label === 'supports')
      return f && f.passage !== null ? [{ article, text: normalizeForHash(passageText(article, f.passage)) }] : []
    })
    for (const a of holders) {
      for (const b of holders) {
        if (a.article.id !== b.article.id && a.text !== '' && a.text === b.text) {
          const set = shared.get(a.article.id) ?? new Set<number>()
          set.add(b.article.id)
          shared.set(a.article.id, set)
        }
      }
    }
  }
  for (const [id, others] of shared) own.get(id)!.sharedWith = [...others].sort((x, y) => x - y)

  // Third pass: an article with no support whose every passage is already
  // carried, word for word, by a supporting article is redundant with it.
  for (const article of snapshot.articles) {
    const entry = own.get(article.id)!
    if (entry.summary !== 'no_support' || article.passages.length === 0) continue
    const covered = article.passages.every((p) => {
      const text = normalizeForHash(p.text)
      return supporting.some((other) => other.passages.some((q) => normalizeForHash(q.text) === text))
    })
    if (covered && !entry.reasons.includes('redundant')) entry.reasons.push('redundant')
  }
  for (const entry of own.values()) entry.reasons.sort((a, b) => (a === b ? 0 : a === 'off_topic' ? -1 : 1))

  return [...snapshot.articles.map((a) => own.get(a.id)!), ...omitted]
}

/**
 * The one state an answer gets, from its articles'. Only a completed
 * assessment has one: anything else is `not_assessed`. Any supporting article
 * makes the answer supported; otherwise any inconclusive article makes it
 * inconclusive; otherwise any article not assessed keeps it `not_assessed`
 * (an unchecked article is never evidence that nothing supports the answer).
 * Only when every article was checked and none supports it, including an
 * answer that was given no articles, is it `no_support`.
 */
export function deriveAnswerSupport(execution: Execution, articles: readonly Pick<ArticleSupport, 'summary'>[]): SupportSummary {
  if (execution.state !== 'completed') return 'not_assessed'
  if (articles.some((a) => a.summary === 'supporting')) return 'supporting'
  if (articles.some((a) => a.summary === 'inconclusive')) return 'inconclusive'
  if (articles.some((a) => a.summary === 'not_assessed')) return 'not_assessed'
  return 'no_support'
}
