import type { KBArticle } from '@/types'
import { contentHash } from '@/lib/kb/revision'

/**
 * How close a saved resolution has to be to a changed documentation chunk
 * (cosine similarity) for the change to count as related to it. Looser than the
 * review queue's near-duplicate bar, because a doc that was rewritten is
 * related to an answer about the same topic without repeating its words.
 */
export const RELATED_DOCS_SIMILARITY = 0.8

/** Most changed chunks compared against resolutions in one sync. */
export const MAX_CHANGED_CHUNKS = 2000

interface ChunkText {
  id: number
  question: string
  answer: string
}

/**
 * The chunks of a rebuilt source that differ from the source it replaces, by
 * the fingerprint of their question and answer: chunks only in the new copy
 * (added, or the new wording of an edited chunk) and chunks only in the old
 * copy (removed, or the old wording of an edited chunk). Both sides count, so a
 * resolution that leaned on text that was deleted or rewritten is found.
 *
 * Returns the ids of those chunks. Order follows the input, old chunks first.
 */
export function changedChunkIds(previous: ChunkText[], next: ChunkText[]): number[] {
  const previousHashes = new Map<number, string>()
  const nextHashes = new Map<number, string>()
  const inPrevious = new Set<string>()
  const inNext = new Set<string>()
  for (const c of previous) {
    const h = contentHash(c.question, c.answer)
    previousHashes.set(c.id, h)
    inPrevious.add(h)
  }
  for (const c of next) {
    const h = contentHash(c.question, c.answer)
    nextHashes.set(c.id, h)
    inNext.add(h)
  }
  const ids: number[] = []
  for (const c of previous) if (!inNext.has(previousHashes.get(c.id)!)) ids.push(c.id)
  for (const c of next) if (!inPrevious.has(nextHashes.get(c.id)!)) ids.push(c.id)
  return ids
}

export interface RelatedDocsChange {
  at: string
  /** Where the docs live, for example the repository the sync read. */
  source: string
}

/**
 * The notice a saved resolution carries, or null. It shows while the docs
 * change is later than both the last time the resolution was saved and the last
 * time a person verified it, so re-saving or verifying it clears the notice
 * without any further write.
 */
export function relatedDocsChange(row: {
  docsChangedAt: string | null
  docsChangedSource: string | null
  updatedAt: string
  verifiedAt: string | null
}): KBArticle['related_docs_changed'] {
  if (!row.docsChangedAt || !row.docsChangedSource) return null
  const changed = Date.parse(row.docsChangedAt)
  if (Number.isNaN(changed)) return null
  const saved = Date.parse(row.updatedAt)
  if (!Number.isNaN(saved) && changed <= saved) return null
  if (row.verifiedAt) {
    const verified = Date.parse(row.verifiedAt)
    if (!Number.isNaN(verified) && changed <= verified) return null
  }
  return { at: row.docsChangedAt, source: row.docsChangedSource }
}
