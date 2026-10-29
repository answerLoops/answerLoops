import type { SupportSnapshot } from './snapshot'
import { articleOf, claimOf, passageOf } from './snapshot'
import { downgradeUnconfirmed, type ValidatedFinding } from './validate'

/** Turns texts into vectors in one call. `tokens` is what the provider billed, for the cost record. */
export type EmbedFn = (texts: string[]) => Promise<{ embeddings: number[][]; tokens: number }>

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return Number.NaN
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? Number.NaN : dot / Math.sqrt(na * nb)
}

export interface SimilarityCheck {
  findings: ValidatedFinding[]
  /** How many supports the check looked at. */
  checked: number
  /** How many it lowered to inconclusive. */
  downgraded: number
  /** The embedding call failed, so no support could be confirmed and every one was lowered. */
  unavailable: boolean
  /** Cosine similarity for each checked finding, keyed "article:claim". */
  scores: Map<string, number>
  tokens: number
}

/**
 * An independent check on the judge: a claim labeled supports must also read as
 * similar to the passage it cites. Below the floor, or when the score cannot be
 * computed at all, the support becomes inconclusive. It can only take support
 * away, and if the embeddings cannot be had it takes all of it away: a check
 * that did not run never counts as a check that passed.
 */
export async function confirmSupports(
  snapshot: SupportSnapshot,
  findings: readonly ValidatedFinding[],
  embed: EmbedFn,
  floor: number
): Promise<SimilarityCheck> {
  const supports = findings.filter((f) => f.label === 'supports')
  if (supports.length === 0) return { findings: [...findings], checked: 0, downgraded: 0, unavailable: false, scores: new Map(), tokens: 0 }

  const pairs = supports.map((f) => {
    const claim = claimOf(snapshot, f.claim)
    const article = articleOf(snapshot, f.article)
    const passage = article && f.passage !== null ? passageOf(article, f.passage) : undefined
    return { finding: f, claim: claim?.text, passage: passage?.text }
  })

  const texts = [...new Set(pairs.flatMap((p) => (p.claim && p.passage ? [p.claim, p.passage] : [])))]
  let vectors: Map<string, number[]> | null = null
  let tokens = 0
  try {
    const result = await embed(texts)
    if (result.embeddings.length === texts.length) {
      vectors = new Map(texts.map((t, i) => [t, result.embeddings[i]]))
      tokens = Number.isFinite(result.tokens) ? result.tokens : 0
    }
  } catch {
    vectors = null
  }

  const scores = new Map<string, number>()
  if (vectors) {
    for (const p of pairs) {
      const a = p.claim ? vectors.get(p.claim) : undefined
      const b = p.passage ? vectors.get(p.passage) : undefined
      scores.set(`${p.finding.article}:${p.finding.claim}`, a && b ? cosine(a, b) : Number.NaN)
    }
  }

  const kept = downgradeUnconfirmed(findings, (f) => {
    const score = scores.get(`${f.article}:${f.claim}`)
    return score !== undefined && score >= floor
  })
  const downgraded = kept.filter((f, i) => f.label !== findings[i].label).length
  return { findings: kept, checked: supports.length, downgraded, unavailable: vectors === null, scores, tokens }
}
