import type { KBAnswerSource, KBAnswerSourceStatus } from '@/types'
import { contentHash } from './revision'

/**
 * Where a source stands now, judged against what was supplied when the answer
 * was generated. The reference keeps a hash of the article as it was then, so
 * this stays accurate after the article is edited, unpublished or deleted.
 *
 * Precedence, most important first: deleted, unpublished, changed, current. An
 * article that is both unpublished and edited reads as unpublished, because
 * that is the thing a reader can act on.
 */
export function sourceStatus(
  storedHash: string,
  article: { question: string; answer: string; published: number } | null
): KBAnswerSourceStatus {
  if (!article) return 'deleted'
  if (article.published !== 1) return 'unpublished'
  return contentHash(article.question, article.answer) === storedHash ? 'current' : 'changed'
}

/** A source as read from the database, with the two fingerprints used to spot exact copies. */
export interface SourceCandidate {
  source: Omit<KBAnswerSource, 'copies'>
  /** The fingerprint recorded when the article was supplied. */
  recordedHash: string
  /** The fingerprint of the article now, or null when it is deleted. */
  currentHash: string | null
}

const isLinkable = (s: { status: KBAnswerSourceStatus }) => s.status === 'current' || s.status === 'changed'

/**
 * Shows each exact source once. Articles that were supplied with identical text
 * (same recorded fingerprint) are one source, and so are live articles whose
 * text is identical now, so the same source is never listed, or linked, twice.
 * The kept entry is the one that can be linked when there is one, otherwise the
 * best ranked. `copies` counts the extra identical articles that were folded in,
 * and the entries stay in the order they were supplied.
 */
export function collapseExactSources(candidates: readonly SourceCandidate[]): KBAnswerSource[] {
  const groups = new Map<string, SourceCandidate[]>()
  for (const c of candidates) {
    const group = groups.get(c.recordedHash)
    if (group) group.push(c)
    else groups.set(c.recordedHash, [c])
  }

  const kept: KBAnswerSource[] = []
  const linkedByCurrent = new Map<string, KBAnswerSource>()
  for (const group of groups.values()) {
    const rep = group.find((c) => isLinkable(c.source)) ?? group[0]
    const copies = group.length - 1
    const earlier = rep.currentHash !== null && isLinkable(rep.source) ? linkedByCurrent.get(rep.currentHash) : undefined
    if (earlier) {
      earlier.copies += copies + 1
      continue
    }
    const entry: KBAnswerSource = { ...rep.source, copies }
    kept.push(entry)
    if (rep.currentHash !== null && isLinkable(rep.source)) linkedByCurrent.set(rep.currentHash, entry)
  }
  return kept.sort((a, b) => a.rank - b.rank)
}
