import { contentHash } from '@/lib/kb/revision'

/**
 * Two articles are exact duplicates when their question and answer have the
 * same content hash (lib/kb/revision.ts): identical words, ignoring only line
 * endings and runs of whitespace. A reworded copy, a different heading over the
 * same body, or an answer with one word changed is not a duplicate.
 */
export function isExactDuplicate(
  a: { question: string; answer: string },
  b: { question: string; answer: string }
): boolean {
  return contentHash(a.question, a.answer) === contentHash(b.question, b.answer)
}

/**
 * Keeps the first of each group of exact duplicates and drops the rest, so
 * the best-ranked copy stays and a repeat never takes another slot. Order is
 * preserved. Stops once `limit` distinct items are kept when one is given.
 */
export function dropExactDuplicates<T extends { question: string; answer: string }>(items: readonly T[], limit?: number): T[] {
  const seen = new Set<string>()
  const kept: T[] = []
  for (const item of items) {
    if (limit !== undefined && kept.length >= limit) break
    const key = contentHash(item.question, item.answer)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(item)
  }
  return kept
}
