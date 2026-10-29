import { describe, it, expect } from 'vitest'
import { buildSnapshot } from '@/lib/kb/support/snapshot'
import { downgradeUnconfirmed, validateJudgeOutput, type ValidatedFinding } from '@/lib/kb/support/validate'

/**
 * The model never writes evidence. It returns ids and labels, and everything
 * shown to a person is copied out of the frozen snapshot by id. These tests
 * pin the shapes that are rejected and show that nothing the judge says can
 * reach a quote.
 */

const snapshot = buildSnapshot({
  question: 'How do I reset my password?',
  answer: 'Use the reset link. It expires in an hour. Contact support if it fails.',
  articles: [
    { id: 10, question: 'Password reset', answer: 'Request a reset link from the sign-in page.\n\nLinks expire after one hour.' },
    { id: 20, question: 'Billing', answer: 'Invoices are sent monthly.' },
  ],
})
// claims: 1 "Use the reset link." 2 "It expires in an hour." 3 "Contact support if it fails."
// article 10 passages: 1 "Request a reset link..." 2 "Links expire after one hour."; article 20: 1 "Invoices are sent monthly."

const valid = {
  findings: [
    { claim: 1, article: 10, passage: 1, label: 'supports' },
    { claim: 2, article: 10, passage: 2, label: 'supports' },
    { claim: 3, article: 10, passage: null, label: 'none' },
  ],
  off_topic: [20],
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const reasonsOf = (raw: unknown) => {
  const r = validateJudgeOutput(snapshot, raw)
  expect(r.ok).toBe(false)
  return r.ok === false && r.kind === 'invalid' ? r.reasons : []
}

describe('a valid judge output', () => {
  it('is accepted and returned as findings built from the snapshot', () => {
    const r = validateJudgeOutput(snapshot, valid)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.offTopic).toEqual([20])
    expect(r.findings.map((f) => [f.article, f.claim, f.passage, f.label])).toEqual([
      [10, 1, 1, 'supports'],
      [10, 2, 2, 'supports'],
      [10, 3, null, 'none'],
    ])
    expect(r.findings[0].claimQuote).toBe('Use the reset link.')
    expect(r.findings[0].passageQuote).toBe('Request a reset link from the sign-in page.')
    expect(r.findings[2].passageQuote).toBeNull()
  })

  it('sorts findings by article then claim whatever order the judge sent them', () => {
    const r = validateJudgeOutput(snapshot, { findings: [...valid.findings].reverse(), off_topic: [20] })
    expect(r.ok && r.findings.map((f) => f.claim)).toEqual([1, 2, 3])
  })

  it('accepts all four labels and an empty off_topic list', () => {
    const r = validateJudgeOutput(snapshot, {
      findings: [
        { claim: 1, article: 10, passage: 1, label: 'supports' },
        { claim: 2, article: 10, passage: 2, label: 'partial' },
        { claim: 3, article: 10, passage: 1, label: 'contradicts' },
        { claim: 1, article: 20, passage: null, label: 'none' },
      ],
      off_topic: [],
    })
    expect(r.ok).toBe(true)
  })

  it('accepts no findings at all when every article is flagged off topic', () => {
    expect(validateJudgeOutput(snapshot, { findings: [], off_topic: [10, 20] }).ok).toBe(true)
  })
})

describe('no output at all', () => {
  it.each([[null], [undefined]])('is "no result", not an invalid answer: %s', (raw) => {
    expect(validateJudgeOutput(snapshot, raw)).toEqual({ ok: false, kind: 'no_result' })
  })
})

describe('every invalid shape is rejected, whole', () => {
  it('rejects a claim id that does not exist', () => {
    const raw = clone(valid)
    raw.findings[0].claim = 99
    expect(reasonsOf(raw)).toEqual(['unknown_claim'])
  })

  it('rejects claim id 0 and negative ids', () => {
    for (const claim of [0, -1]) {
      const raw = clone(valid)
      raw.findings[0].claim = claim
      expect(reasonsOf(raw)).toEqual(['malformed'])
    }
  })

  it('rejects an article that was never supplied', () => {
    const raw = clone(valid)
    raw.findings[0].article = 777
    expect(reasonsOf(raw)).toContain('unknown_article')
  })

  it('rejects an article that was supplied but left out of the snapshot', () => {
    const big = buildSnapshot({
      question: 'q',
      answer: 'A claim.',
      articles: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, question: `a${i}`, answer: 'Text.' })),
    })
    expect(big.omittedArticleIds).toEqual([9, 10])
    const r = validateJudgeOutput(big, { findings: [{ claim: 1, article: 10, passage: 1, label: 'supports' }], off_topic: [] })
    expect(r).toMatchObject({ ok: false, kind: 'invalid', reasons: ['unknown_article'] })
  })

  it('rejects a passage that is not in that article, even if another article has it', () => {
    const raw = clone(valid)
    raw.findings[0] = { claim: 1, article: 20, passage: 2, label: 'supports' } // article 20 has one passage
    expect(reasonsOf(raw)).toContain('unknown_passage')
  })

  it('rejects the same article and claim cited twice', () => {
    const raw = clone(valid)
    raw.findings.push({ claim: 1, article: 10, passage: 2, label: 'partial' })
    expect(reasonsOf(raw)).toContain('duplicate_finding')
  })

  it('rejects an exact repeated finding', () => {
    const raw = clone(valid)
    raw.findings.push({ ...raw.findings[0] })
    expect(reasonsOf(raw)).toContain('duplicate_finding')
  })

  it('rejects an article listed off topic twice', () => {
    expect(reasonsOf({ findings: [], off_topic: [20, 20] })).toContain('duplicate_off_topic')
  })

  it('rejects an unknown article in off_topic', () => {
    expect(reasonsOf({ findings: [], off_topic: [555] })).toContain('unknown_article')
  })

  it('rejects a supporting, partial or contradicting finding with no passage', () => {
    for (const label of ['supports', 'partial', 'contradicts']) {
      const raw = clone(valid)
      raw.findings[0] = { claim: 1, article: 10, passage: null, label }
      expect(reasonsOf(raw)).toContain('passage_required')
    }
  })

  it('rejects a "none" finding that points at a passage', () => {
    const raw = clone(valid)
    raw.findings[2] = { claim: 3, article: 10, passage: 1, label: 'none' }
    expect(reasonsOf(raw)).toContain('passage_not_allowed')
  })

  it('rejects an article flagged off topic that also has a non-"none" finding', () => {
    const raw = clone(valid)
    raw.off_topic = [10, 20]
    expect(reasonsOf(raw)).toContain('off_topic_with_findings')
  })

  it('allows an off-topic article to carry only "none" findings', () => {
    const r = validateJudgeOutput(snapshot, {
      findings: [{ claim: 1, article: 20, passage: null, label: 'none' }],
      off_topic: [20],
    })
    expect(r.ok).toBe(true)
  })

  it.each([
    ['a label outside the enum', { claim: 1, article: 10, passage: 1, label: 'strongly_supports' }],
    ['the code-only label inconclusive', { claim: 1, article: 10, passage: 1, label: 'inconclusive' }],
    ['a numeric label', { claim: 1, article: 10, passage: 1, label: 1 }],
    ['a fractional claim id', { claim: 1.5, article: 10, passage: 1, label: 'supports' }],
    ['a string claim id', { claim: '1', article: 10, passage: 1, label: 'supports' }],
    ['a missing label', { claim: 1, article: 10, passage: 1 }],
    ['a missing passage key', { claim: 1, article: 10, label: 'none' }],
    ['an extra free-text field', { claim: 1, article: 10, passage: 1, label: 'supports', quote: 'The reset link works.' }],
    ['a confidence number', { claim: 1, article: 10, passage: 1, label: 'supports', confidence: 0.99 }],
    ['an explanation', { claim: 1, article: 10, passage: 1, label: 'supports', reason: 'it says so' }],
  ])('rejects %s as malformed', (_name, finding) => {
    expect(reasonsOf({ findings: [finding], off_topic: [] })).toEqual(['malformed'])
  })

  it.each([
    ['an array', []],
    ['a string', 'supports'],
    ['a number', 7],
    ['an empty object', {}],
    ['findings missing', { off_topic: [] }],
    ['off_topic missing', { findings: [] }],
    ['an extra top-level field', { findings: [], off_topic: [], summary: 'looks good' }],
    ['findings not an array', { findings: 'none', off_topic: [] }],
    ['null findings', { findings: null, off_topic: [] }],
  ])('rejects %s as malformed', (_name, raw) => {
    expect(validateJudgeOutput(snapshot, raw)).toEqual({ ok: false, kind: 'invalid', reasons: ['malformed'] })
  })

  it('rejects an output with more findings than there are claim and article pairs', () => {
    const findings = Array.from({ length: 400 }, () => ({ claim: 1, article: 10, passage: 1, label: 'supports' }))
    expect(validateJudgeOutput(snapshot, { findings, off_topic: [] })).toMatchObject({ ok: false, kind: 'invalid' })
  })

  it('rejects the whole output when one finding is bad, even if the others are fine', () => {
    const raw = clone(valid)
    raw.findings.push({ claim: 99, article: 10, passage: 1, label: 'supports' })
    const r = validateJudgeOutput(snapshot, raw)
    expect(r.ok).toBe(false)
    expect('findings' in r).toBe(false)
  })

  it('lists every distinct problem once, in a fixed order', () => {
    const raw = {
      findings: [
        { claim: 99, article: 10, passage: 1, label: 'supports' },
        { claim: 1, article: 555, passage: 1, label: 'supports' },
        { claim: 2, article: 10, passage: 9, label: 'supports' },
        { claim: 2, article: 10, passage: 1, label: 'supports' },
      ],
      off_topic: [],
    }
    expect(reasonsOf(raw)).toEqual(['unknown_claim', 'unknown_article', 'unknown_passage', 'duplicate_finding'])
  })
})

describe('the model never authors evidence', () => {
  it('a text field the judge adds is rejected, so forged text cannot ride in', () => {
    const forged = { claim: 1, article: 10, passage: 1, label: 'supports', quote: 'FORGED QUOTE', passage_text: 'FORGED' }
    expect(validateJudgeOutput(snapshot, { findings: [forged], off_topic: [] }).ok).toBe(false)
  })

  // A small deterministic generator, so the property below is reproducible.
  const lcg = (seed: number) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }

  it('for any valid output, every quote is a substring of the snapshot and never of judge output', () => {
    const rand = lcg(42)
    const snapshotText = [
      ...snapshot.claims.map((c) => c.text),
      ...snapshot.articles.flatMap((a) => a.passages.map((p) => p.text)),
    ]
    let accepted = 0
    for (let n = 0; n < 500; n++) {
      const findings = []
      for (const article of snapshot.articles) {
        for (const claim of snapshot.claims) {
          if (rand() < 0.3) continue
          const label = (['supports', 'partial', 'contradicts', 'none'] as const)[Math.floor(rand() * 4)]
          const passage =
            label === 'none' ? null : article.passages[Math.floor(rand() * article.passages.length)]?.index ?? null
          findings.push({ claim: claim.index, article: article.id, passage, label })
        }
      }
      // Some outputs carry junk the judge hoped would be echoed back.
      const junk = rand() < 0.5 ? { note: 'JUDGE-AUTHORED TEXT' } : {}
      const r = validateJudgeOutput(snapshot, { findings: findings.map((f) => ({ ...f, ...junk })), off_topic: [] })
      if (!r.ok) {
        expect(Object.keys(junk).length > 0 || findings.some((f) => f.label !== 'none' && f.passage === null)).toBe(true)
        continue
      }
      accepted++
      for (const f of r.findings) {
        expect(snapshotText.some((t) => t.includes(f.claimQuote))).toBe(true)
        if (f.passageQuote !== null) expect(snapshotText.some((t) => t.includes(f.passageQuote!))).toBe(true)
        expect(JSON.stringify(f)).not.toContain('JUDGE-AUTHORED')
      }
    }
    expect(accepted).toBeGreaterThan(50)
  })
})

describe('downgradeUnconfirmed', () => {
  const findings: ValidatedFinding[] = [
    { claim: 1, article: 10, passage: 1, label: 'supports', claimQuote: 'a', passageQuote: 'b' },
    { claim: 2, article: 10, passage: 2, label: 'supports', claimQuote: 'c', passageQuote: 'd' },
    { claim: 3, article: 10, passage: 1, label: 'partial', claimQuote: 'e', passageQuote: 'f' },
    { claim: 1, article: 20, passage: null, label: 'none', claimQuote: 'a', passageQuote: null },
  ]

  it('lowers only the support the check does not confirm, to inconclusive', () => {
    const out = downgradeUnconfirmed(findings, (f) => f.claim === 1)
    expect(out.map((f) => f.label)).toEqual(['supports', 'inconclusive', 'partial', 'none'])
  })

  it('can never raise a label', () => {
    const rank = { none: 0, inconclusive: 1, partial: 2, contradicts: 2, supports: 3 } as const
    for (const keep of [() => true, () => false, (f: ValidatedFinding) => f.claim === 2]) {
      const out = downgradeUnconfirmed(findings, keep)
      out.forEach((f, i) => expect(rank[f.label]).toBeLessThanOrEqual(rank[findings[i].label]))
    }
  })

  it('does not change its input', () => {
    downgradeUnconfirmed(findings, () => false)
    expect(findings[0].label).toBe('supports')
  })
})
