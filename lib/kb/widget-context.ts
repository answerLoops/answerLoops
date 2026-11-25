/** How similar an article must be to a question to count as a match. */
export const KB_MATCH_THRESHOLD = 0.45

// The lowest similarity the website widget still offers the model as a near
// miss when nothing clears KB_MATCH_THRESHOLD.
export const KB_NEAR_MISS_FLOOR = 0.3

/**
 * Which articles the website widget hands the assistant, from search results
 * at or above KB_NEAR_MISS_FLOOR (best first).
 *
 * Visitors often ask loosely ("what does it cost?") and the wording rarely
 * matches the article that answers it, so a question can score just under the
 * match bar against exactly the right article. Rather than answering with
 * nothing, the widget falls back to the closest articles and lets the model
 * judge whether they cover the question. Articles that clear the bar always
 * win: near misses are only supplied when none do. `matched` says which case
 * this is.
 */
export function chooseWidgetContext<T extends { score: number }>(results: T[]): { results: T[]; matched: boolean } {
  const strong = results.filter((a) => a.score >= KB_MATCH_THRESHOLD)
  return strong.length > 0 ? { results: strong, matched: true } : { results, matched: false }
}
