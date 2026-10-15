import { describe, it, expect } from 'vitest'
import { clusterGaps } from '@/lib/ai/gap-clusters'

// Unit vectors on the x/y plane: cosine similarity is the cosine of the angle
// between them, so the test controls similarity exactly.
const at = (degrees: number): number[] => {
  const r = (degrees * Math.PI) / 180
  return [Math.cos(r), Math.sin(r)]
}

const gap = (id: number) => ({ id })

describe('clusterGaps', () => {
  it('folds near-identical questions into one cluster led by the highest-ranked gap', () => {
    const gaps = [gap(1), gap(2), gap(3)]
    const vectors = new Map([[1, at(0)], [2, at(5)], [3, at(2)]])

    const clusters = clusterGaps(gaps, vectors)

    expect(clusters).toHaveLength(1)
    expect(clusters[0].lead.id).toBe(1)
    expect(clusters[0].members.map((m) => m.id)).toEqual([1, 2, 3])
    expect(clusters[0].count).toBe(3)
  })

  it('keeps unrelated questions apart', () => {
    const clusters = clusterGaps([gap(1), gap(2)], new Map([[1, at(0)], [2, at(90)]]))

    expect(clusters.map((c) => c.count)).toEqual([1, 1])
  })

  it('merges at exactly the threshold and not just below it', () => {
    const vectors = new Map([[1, at(0)], [2, at(30)]])
    const similarity = Math.cos((30 * Math.PI) / 180)

    expect(clusterGaps([gap(1), gap(2)], vectors, similarity - 1e-9)).toHaveLength(1)
    expect(clusterGaps([gap(1), gap(2)], vectors, similarity + 1e-9)).toHaveLength(2)
  })

  it('leaves a gap with no vector as its own cluster', () => {
    const clusters = clusterGaps([gap(1), gap(2), gap(3)], new Map([[1, at(0)], [3, at(1)]]))

    expect(clusters.map((c) => c.members.map((m) => m.id))).toEqual([[1, 3], [2]])
  })

  it('does not chain loosely related questions through a middle one', () => {
    // 1~2 and 2~3 are close, but 1 and 3 are not. Only the lead is compared, so
    // 3 must not be pulled in through 2.
    const vectors = new Map([[1, at(0)], [2, at(25)], [3, at(50)]])
    const similarity = Math.cos((25 * Math.PI) / 180)

    const clusters = clusterGaps([gap(1), gap(2), gap(3)], vectors, similarity - 1e-9)

    expect(clusters.map((c) => c.members.map((m) => m.id))).toEqual([[1, 2], [3]])
  })

  it('returns the most-asked cluster first and keeps input order on ties', () => {
    const gaps = [gap(1), gap(2), gap(3), gap(4), gap(5)]
    const vectors = new Map([[1, at(0)], [2, at(90)], [3, at(91)], [4, at(180)], [5, at(92)]])

    const clusters = clusterGaps(gaps, vectors)

    expect(clusters.map((c) => c.members.map((m) => m.id))).toEqual([[2, 3, 5], [1], [4]])
  })

  it('ignores a vector of a different length instead of throwing', () => {
    const clusters = clusterGaps([gap(1), gap(2)], new Map([[1, at(0)], [2, [1, 0, 0]]]))

    expect(clusters).toHaveLength(2)
  })

  it('returns nothing for no gaps', () => {
    expect(clusterGaps([], new Map())).toEqual([])
  })
})
