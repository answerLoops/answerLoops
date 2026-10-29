/**
 * Bounds on what one assessment sees. Every piece of text the judge is shown
 * passes through these, so one long answer or article can never make the
 * snapshot, the prompt, or a stored finding unbounded. Anything cut off is
 * flagged (`truncated` / `clipped`), never dropped silently.
 */
export const SUPPORT_LIMITS = Object.freeze({
  /** Longest text segmented at all; anything past this is ignored and flagged. */
  maxInputChars: 100_000,
  /** The question shown to the judge, for context only. */
  maxQuestionChars: 600,
  maxClaims: 40,
  maxClaimChars: 600,
  /** Supplied articles in one snapshot; the rest are recorded as omitted. */
  maxArticles: 8,
  maxPassagesPerArticle: 60,
  maxPassageChars: 1_200,
  /** The most of a claim or passage a quote may carry (about one sentence). */
  maxQuoteChars: 300,
})
