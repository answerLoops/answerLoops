import { contentHash } from '@/lib/kb/revision'
import { SUPPORT_LIMITS } from './limits'
import { segmentAnswer, segmentArticle, normalizeText, type Piece } from './segment'

export interface SnapshotArticle {
  id: number
  /** The article's fingerprint as supplied (`contentHash` of its question and answer). */
  hash: string
  /** Its title, shown to the judge as context. A finding can never point at it. */
  title: string
  passages: readonly Piece[]
  /** The article had more text than the passage limits keep. */
  truncated: boolean
}

/**
 * Everything a judge is allowed to see, frozen: the question, the answer's
 * numbered claims, and each supplied article's numbered passages. It exists
 * only in memory while an answer is being assessed. Findings refer to it by
 * id, and every quote shown to a person is copied out of it, so nothing the
 * judge writes can become evidence.
 */
export interface SupportSnapshot {
  readonly question: string
  readonly claims: readonly Piece[]
  readonly claimsTruncated: boolean
  readonly articles: readonly SnapshotArticle[]
  /** Supplied articles left out because the snapshot holds only `maxArticles`. */
  readonly omittedArticleIds: readonly number[]
}

export interface SuppliedArticle {
  id: number
  question: string
  answer: string
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

function boundedQuestion(question: string): string {
  const text = normalizeText(question).trim()
  if (text.length <= SUPPORT_LIMITS.maxQuestionChars) return text
  let cut = SUPPORT_LIMITS.maxQuestionChars
  const code = text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut--
  return text.slice(0, cut)
}

/**
 * Builds the snapshot for one answer. Articles are taken in the order they were
 * supplied; a repeated article id is counted once, and any beyond the limit are
 * listed in `omittedArticleIds` so the caller can record them as not assessed
 * instead of losing them.
 */
export function buildSnapshot(input: {
  question: string
  answer: string
  articles: readonly SuppliedArticle[]
}): SupportSnapshot {
  const claims = segmentAnswer(input.answer)
  const seen = new Set<number>()
  const articles: SnapshotArticle[] = []
  const omittedArticleIds: number[] = []

  for (const article of input.articles) {
    if (seen.has(article.id)) continue
    seen.add(article.id)
    if (articles.length >= SUPPORT_LIMITS.maxArticles) {
      omittedArticleIds.push(article.id)
      continue
    }
    const passages = segmentArticle(article.answer)
    articles.push({
      id: article.id,
      hash: contentHash(article.question, article.answer),
      title: boundedQuestion(article.question),
      passages: passages.pieces,
      truncated: passages.truncated,
    })
  }

  return deepFreeze({
    question: boundedQuestion(input.question),
    claims: claims.pieces,
    claimsTruncated: claims.truncated,
    articles,
    omittedArticleIds,
  })
}

/** An answer with no claims, or no articles to check, has nothing for a judge to do. */
export function hasWorkForJudge(snapshot: SupportSnapshot): boolean {
  return snapshot.claims.length > 0 && snapshot.articles.length > 0
}

export function claimOf(snapshot: SupportSnapshot, index: number): Piece | undefined {
  return snapshot.claims.find((c) => c.index === index)
}

export function articleOf(snapshot: SupportSnapshot, id: number): SnapshotArticle | undefined {
  return snapshot.articles.find((a) => a.id === id)
}

export function passageOf(article: SnapshotArticle, index: number): Piece | undefined {
  return article.passages.find((p) => p.index === index)
}

/**
 * The most of a piece a person is shown: its own text, cut to the quote limit
 * at a code-point boundary. It is always a prefix of snapshot text.
 */
export function quoteOf(piece: Piece): string {
  const max = SUPPORT_LIMITS.maxQuoteChars
  if (piece.text.length <= max) return piece.text
  let cut = max
  const code = piece.text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut--
  return piece.text.slice(0, cut)
}
