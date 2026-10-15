import { cosineSimilarity } from 'ai'
import { DUPLICATE_THRESHOLD } from '@/lib/ai/related'

export interface GapCluster<T> {
  /** The gap the others were folded into: the first one in the input order. */
  lead: T
  /** Every gap in the cluster, `lead` included, in input order. */
  members: T[]
  /** How many times the question was asked. Same as `members.length`. */
  count: number
}

/**
 * Folds gaps that are the same question into one cluster so a question asked
 * twelve times is one row with a count, not twelve rows.
 *
 * Each cluster is anchored on its lead (the first gap in input order, which the
 * caller has already ranked) and only absorbs gaps that are close to the lead
 * itself. Comparing against the lead rather than any member keeps a chain of
 * loosely related questions from snowballing into one topic-sized cluster.
 *
 * A gap with no vector (no embedding stored, or one made by a different model)
 * cannot be compared and stays a cluster of one. Clusters are returned most
 * asked first; ties keep the input order.
 */
export function clusterGaps<T extends { id: number }>(
  gaps: T[],
  vectors: Map<number, number[]>,
  threshold: number = DUPLICATE_THRESHOLD
): GapCluster<T>[] {
  const claimed = new Set<number>()
  const clusters: GapCluster<T>[] = []

  for (const lead of gaps) {
    if (claimed.has(lead.id)) continue
    claimed.add(lead.id)
    const members = [lead]
    const leadVector = vectors.get(lead.id)

    if (leadVector) {
      for (const other of gaps) {
        if (claimed.has(other.id)) continue
        const otherVector = vectors.get(other.id)
        if (!otherVector || otherVector.length !== leadVector.length) continue
        if (cosineSimilarity(leadVector, otherVector) >= threshold) {
          claimed.add(other.id)
          members.push(other)
        }
      }
    }
    clusters.push({ lead, members, count: members.length })
  }

  // Array.prototype.sort is stable, so equal counts keep the caller's ranking.
  return clusters.sort((a, b) => b.count - a.count)
}
