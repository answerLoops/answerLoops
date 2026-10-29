import { describe, it, expect, vi } from 'vitest'
import { buildSnapshot } from '@/lib/kb/support/snapshot'
import { confirmSupports, cosine, type EmbedFn } from '@/lib/kb/support/similarity'
import { validateJudgeOutput, type ValidatedFinding } from '@/lib/kb/support/validate'

const snapshot = buildSnapshot({
  question: 'q',
  answer: 'The link expires after an hour. Invoices are monthly.',
  articles: [
    { id: 1, question: 'Reset', answer: 'Links expire after 60 minutes.' },
    { id: 2, question: 'Billing', answer: 'Invoices are sent monthly.' },
  ],
})

const findings = (raw: unknown): ValidatedFinding[] => {
  const r = validateJudgeOutput(snapshot, raw)
  if (!r.ok) throw new Error('fixture invalid')
  return r.findings
}

const judged = findings({
  findings: [
    { claim: 1, article: 1, passage: 1, label: 'supports' },
    { claim: 2, article: 1, passage: null, label: 'none' },
    { claim: 1, article: 2, passage: null, label: 'none' },
    { claim: 2, article: 2, passage: 1, label: 'supports' },
  ],
  off_topic: [],
})

/** Vectors chosen so each text has a known cosine with its partner. */
const vectors: Record<string, number[]> = {
  'The link expires after an hour.': [1, 0],
  'Links expire after 60 minutes.': [1, 0], // cosine 1 with the claim
  'Invoices are monthly.': [1, 0],
  'Invoices are sent monthly.': [0, 1], // cosine 0 with the claim
}
const embedFrom = (table: Record<string, number[]>): EmbedFn =>
  vi.fn(async (texts: string[]) => ({ embeddings: texts.map((t) => table[t]), tokens: texts.length * 10 }))

describe('cosine', () => {
  it('is 1 for the same direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
  })
  it('is NaN, never a number that could pass a floor, for empty, mismatched or zero vectors', () => {
    expect(cosine([], [])).toBeNaN()
    expect(cosine([1, 2], [1])).toBeNaN()
    expect(cosine([0, 0], [1, 1])).toBeNaN()
  })
})

describe('confirmSupports', () => {
  it('keeps a support whose claim and passage are similar and lowers one that are not', async () => {
    const check = await confirmSupports(snapshot, judged, embedFrom(vectors), 0.3)
    const byPair = Object.fromEntries(check.findings.map((f) => [`${f.article}:${f.claim}`, f.label]))
    expect(byPair['1:1']).toBe('supports')
    expect(byPair['2:2']).toBe('inconclusive')
    expect(check).toMatchObject({ checked: 2, downgraded: 1, unavailable: false })
    expect(check.scores.get('1:1')).toBeCloseTo(1)
    expect(check.scores.get('2:2')).toBeCloseTo(0)
  })

  it('applies the floor it is given: a score at the floor is kept, just under it is not', async () => {
    const table = { ...vectors, 'Invoices are sent monthly.': [3, 4] } // cosine 0.6 with [1, 0]
    expect((await confirmSupports(snapshot, judged, embedFrom(table), 0.6)).findings.find((f) => f.article === 2 && f.claim === 2)!.label).toBe('supports')
    expect((await confirmSupports(snapshot, judged, embedFrom(table), 0.61)).findings.find((f) => f.article === 2 && f.claim === 2)!.label).toBe('inconclusive')
  })

  it('never touches a label that is not supports', async () => {
    const check = await confirmSupports(snapshot, judged, embedFrom({ ...vectors, 'Invoices are sent monthly.': [0, 1] }), 0.99)
    for (const f of check.findings.filter((x) => x.label !== 'supports' && x.label !== 'inconclusive')) {
      expect(f.label).toBe(judged.find((j) => j.article === f.article && j.claim === f.claim)!.label)
    }
    expect(check.findings.filter((f) => f.label === 'none')).toHaveLength(2)
  })

  it('never raises a label, whatever the floor or the vectors', async () => {
    const rank = { none: 0, inconclusive: 1, partial: 2, contradicts: 2, supports: 3 } as const
    for (const floor of [-1, 0, 0.3, 0.99, 1]) {
      const check = await confirmSupports(snapshot, judged, embedFrom(vectors), floor)
      check.findings.forEach((f, i) => expect(rank[f.label]).toBeLessThanOrEqual(rank[judged[i].label]))
    }
  })

  it('makes one embedding call for all the texts, each text once', async () => {
    const embed = embedFrom(vectors)
    await confirmSupports(snapshot, judged, embed, 0.3)
    expect(embed).toHaveBeenCalledTimes(1)
    const texts = (embed as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(new Set(texts).size).toBe(texts.length)
    expect(texts).toHaveLength(4)
  })

  it('does not call the embedding service at all when there is no support to check', async () => {
    const none = judged.map((f) => ({ ...f, label: 'none' as const, passage: null, passageQuote: null }))
    const embed = embedFrom(vectors)
    const check = await confirmSupports(snapshot, none, embed, 0.3)
    expect(embed).not.toHaveBeenCalled()
    expect(check).toMatchObject({ checked: 0, downgraded: 0, unavailable: false, tokens: 0 })
  })

  it('lowers every support when the embedding call fails: a check that did not run is not a pass', async () => {
    const check = await confirmSupports(snapshot, judged, vi.fn(async () => { throw new Error('provider down') }), 0.3)
    expect(check.unavailable).toBe(true)
    expect(check.findings.filter((f) => f.label === 'supports')).toHaveLength(0)
    expect(check.findings.filter((f) => f.label === 'inconclusive')).toHaveLength(2)
    expect(check.downgraded).toBe(2)
  })

  it('treats a result with the wrong number of vectors as unavailable', async () => {
    const check = await confirmSupports(snapshot, judged, async () => ({ embeddings: [[1, 0]], tokens: 1 }), 0.3)
    expect(check.unavailable).toBe(true)
    expect(check.findings.some((f) => f.label === 'supports')).toBe(false)
  })

  it('lowers a support whose similarity cannot be computed', async () => {
    const check = await confirmSupports(snapshot, judged, embedFrom({ ...vectors, 'Links expire after 60 minutes.': [0, 0] }), 0.3)
    expect(check.findings.find((f) => f.article === 1 && f.claim === 1)!.label).toBe('inconclusive')
  })

  it('reports the tokens the provider billed, and ignores a nonsense count', async () => {
    expect((await confirmSupports(snapshot, judged, embedFrom(vectors), 0.3)).tokens).toBe(40)
    const odd = await confirmSupports(snapshot, judged, async (t) => ({ embeddings: t.map((x) => vectors[x]), tokens: Number.NaN }), 0.3)
    expect(odd.tokens).toBe(0)
  })

  it('does not change the findings it was given', async () => {
    const before = JSON.stringify(judged)
    await confirmSupports(snapshot, judged, embedFrom(vectors), 0.99)
    expect(JSON.stringify(judged)).toBe(before)
  })
})
