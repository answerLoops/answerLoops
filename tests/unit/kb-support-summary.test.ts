import { describe, it, expect } from 'vitest'
import { buildSnapshot } from '@/lib/kb/support/snapshot'
import { downgradeUnconfirmed, validateJudgeOutput, type ValidationResult } from '@/lib/kb/support/validate'
import { deriveAnswerSupport, deriveArticleSupport, type ArticleSupport, type SupportSummary } from '@/lib/kb/support/summary'
import { FAIL_REASONS, SKIP_REASONS, type Execution } from '@/lib/kb/support/state'

const COMPLETED: Execution = { state: 'completed' }

// claims: 1 "Use the reset link." 2 "It expires in an hour." 3 "Contact support if it fails."
const snapshot = buildSnapshot({
  question: 'How do I reset my password?',
  answer: 'Use the reset link. It expires in an hour. Contact support if it fails.',
  articles: [
    { id: 10, question: 'Password reset', answer: 'Request a reset link from the sign-in page.\n\nLinks expire after one hour.' },
    { id: 20, question: 'Billing', answer: 'Invoices are sent monthly.' },
    // An exact copy of article 10's body under another title.
    { id: 30, question: 'Password reset (old)', answer: 'Request a reset link from the sign-in page.\n\nLinks expire after one hour.' },
  ],
})

type F = { claim: number; article: number; passage: number | null; label: string }
const none = (article: number, claims = [1, 2, 3]): F[] => claims.map((claim) => ({ claim, article, passage: null, label: 'none' }))
const run = (findings: F[], off_topic: number[] = []): ValidationResult => validateJudgeOutput(snapshot, { findings, off_topic })
const derive = (validation?: ValidationResult, execution: Execution = COMPLETED) => deriveArticleSupport(snapshot, { execution, validation })
const byId = (rows: ArticleSupport[], id: number) => rows.find((r) => r.articleId === id)!
const summaries = (rows: ArticleSupport[]) => Object.fromEntries(rows.map((r) => [r.articleId, r.summary]))

describe('article summary: one mutually exclusive state', () => {
  it('supporting: any supporting finding makes the article supporting', () => {
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'supports' }, ...none(10, [2, 3]), ...none(20), ...none(30)]))
    expect(byId(rows, 10).summary).toBe('supporting')
  })

  it('a contradiction does not stop support, and stays in the claim detail', () => {
    const rows = derive(
      run([
        { claim: 1, article: 10, passage: 1, label: 'supports' },
        { claim: 2, article: 10, passage: 2, label: 'contradicts' },
        ...none(10, [3]),
        ...none(20),
        ...none(30),
      ])
    )
    const row = byId(rows, 10)
    expect(row.summary).toBe('supporting')
    expect(row.findings.map((f) => f.label).sort()).toEqual(['contradicts', 'none', 'supports'])
  })

  it('partial support alone is inconclusive, not supporting', () => {
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'partial' }, ...none(10, [2, 3]), ...none(20), ...none(30)]))
    expect(byId(rows, 10).summary).toBe('inconclusive')
  })

  it('no support: every claim checked, and none is supported', () => {
    const rows = derive(run([...none(10), ...none(20), ...none(30)]))
    expect(summaries(rows)).toEqual({ 10: 'no_support', 20: 'no_support', 30: 'no_support' })
  })

  it('a contradiction with no support is no support, with the contradiction in the detail', () => {
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'contradicts' }, ...none(10, [2, 3]), ...none(20), ...none(30)]))
    expect(byId(rows, 10).summary).toBe('no_support')
    expect(byId(rows, 10).findings.some((f) => f.label === 'contradicts')).toBe(true)
  })

  it('an article the judge skipped some claims for is inconclusive, never no support', () => {
    const rows = derive(run([...none(10, [1, 2]), ...none(20), ...none(30)])) // claim 3 missing for article 10
    expect(byId(rows, 10).summary).toBe('inconclusive')
    expect(byId(rows, 20).summary).toBe('no_support')
  })

  it('an article the judge said nothing about is inconclusive, never no support', () => {
    const rows = derive(run([...none(10), ...none(20)])) // nothing for article 30, and it is not off topic
    expect(byId(rows, 30).summary).toBe('inconclusive')
  })

  it('a supporting finding still counts when other claims were left out', () => {
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'supports' }, ...none(20), ...none(30)]))
    expect(byId(rows, 10).summary).toBe('supporting')
  })

  it('a support the independent check did not confirm is inconclusive, and a confirmed one stays supporting', () => {
    const validation = run([
      { claim: 1, article: 10, passage: 1, label: 'supports' },
      ...none(10, [2, 3]),
      { claim: 1, article: 30, passage: 1, label: 'supports' },
      ...none(30, [2, 3]),
      ...none(20),
    ])
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    const downgraded: ValidationResult = { ...validation, findings: downgradeUnconfirmed(validation.findings, (f) => f.article === 10) }
    const rows = derive(downgraded)
    expect(byId(rows, 10).summary).toBe('supporting')
    expect(byId(rows, 30).summary).toBe('inconclusive')
  })
})

describe('reasons: a fixed set, only for articles with no supporting evidence', () => {
  it('off_topic when the judge flagged the article and it has no findings', () => {
    const rows = derive(run([...none(10), ...none(30)], [20]))
    expect(byId(rows, 20)).toMatchObject({ summary: 'no_support', reasons: ['off_topic'] })
  })

  it('an off-topic article may carry explicit "none" findings too', () => {
    const rows = derive(run([...none(10), ...none(20), ...none(30)], [20]))
    expect(byId(rows, 20).reasons).toEqual(['off_topic'])
  })

  it('redundant when its every passage is already carried word for word by a supporting article', () => {
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'supports' }, ...none(10, [2, 3]), ...none(20), ...none(30)]))
    expect(byId(rows, 10).summary).toBe('supporting')
    expect(byId(rows, 30)).toMatchObject({ summary: 'no_support', reasons: ['redundant'] })
  })

  it('both reasons may apply, in a fixed order', () => {
    // Article 30 duplicates article 10 and is also flagged off topic.
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'supports' }, ...none(10, [2, 3]), ...none(20)], [30]))
    expect(byId(rows, 30).reasons).toEqual(['off_topic', 'redundant'])
  })

  it('a different article is not redundant just because it has no support', () => {
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'supports' }, ...none(10, [2, 3]), ...none(20), ...none(30)]))
    expect(byId(rows, 20).reasons).toEqual([])
  })

  it('never gives a reason to an article that is supporting, inconclusive or not assessed', () => {
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'supports' }, ...none(10, [2, 3]), ...none(20, [1]), ...none(30)], [20]))
    for (const row of rows) if (row.summary !== 'no_support') expect(row.reasons).toEqual([])
  })

  it('emits only reasons from the fixed set, whatever the input', () => {
    const allowed = new Set(['off_topic', 'redundant'])
    for (const off of [[], [10], [20], [30], [20, 30]]) {
      for (const supports of [true, false]) {
        const findings = [...(supports ? [{ claim: 1, article: 10, passage: 1, label: 'supports' }] : none(10, [1])), ...none(10, [2, 3]), ...none(20), ...none(30)]
        for (const row of derive(run(findings, off))) for (const r of row.reasons) expect(allowed.has(r)).toBe(true)
      }
    }
    // No code path produces a "preferred" or "model leaned on" reason.
    const source = JSON.stringify(derive(run([...none(10), ...none(20), ...none(30)])))
    expect(source).not.toMatch(/preferred|leaned|relied/i)
  })
})

describe('shared support: never a unique attribution', () => {
  it('two articles carrying the same passage for a claim are each supporting and each says it is shared', () => {
    const rows = derive(
      run([
        { claim: 1, article: 10, passage: 1, label: 'supports' },
        { claim: 1, article: 30, passage: 1, label: 'supports' },
        ...none(10, [2, 3]),
        ...none(30, [2, 3]),
        ...none(20),
      ])
    )
    expect(byId(rows, 10)).toMatchObject({ summary: 'supporting', sharedWith: [30] })
    expect(byId(rows, 30)).toMatchObject({ summary: 'supporting', sharedWith: [10] })
  })

  it('different passages that merely support the same claim are not shared', () => {
    const rows = derive(
      run([
        { claim: 2, article: 10, passage: 2, label: 'supports' },
        { claim: 2, article: 20, passage: 1, label: 'supports' },
        ...none(10, [1, 3]),
        ...none(20, [1, 3]),
        ...none(30),
      ])
    )
    expect(byId(rows, 10).sharedWith).toEqual([])
    expect(byId(rows, 20).sharedWith).toEqual([])
  })

  it('copies that differ only in spacing still share', () => {
    const snap = buildSnapshot({
      question: 'q',
      answer: 'Links expire after one hour.',
      articles: [
        { id: 1, question: 'A', answer: 'Links expire after one hour.' },
        { id: 2, question: 'B', answer: 'Links  expire\r\nafter one hour.' },
      ],
    })
    const validation = validateJudgeOutput(snap, {
      findings: [
        { claim: 1, article: 1, passage: 1, label: 'supports' },
        { claim: 1, article: 2, passage: 1, label: 'supports' },
      ],
      off_topic: [],
    })
    const rows = deriveArticleSupport(snap, { execution: COMPLETED, validation })
    expect(rows.map((r) => r.sharedWith)).toEqual([[2], [1]])
  })

  it('no result has an attribution field at all that points to a single source', () => {
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'supports' }, ...none(10, [2, 3]), ...none(20), ...none(30)]))
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['articleId', 'findings', 'reasons', 'sharedWith', 'summary'])
  })
})

describe('failures only move downward', () => {
  const states: Execution[] = [
    { state: 'not_scheduled' },
    { state: 'pending' },
    { state: 'running' },
    ...FAIL_REASONS.map((reason) => ({ state: 'failed' as const, reason })),
    ...SKIP_REASONS.map((reason) => ({ state: 'skipped' as const, reason })),
  ]

  it.each(states.map((s) => [JSON.stringify(s), s] as const))('%s: every article is not assessed, even with a valid answer attached', (_label, execution) => {
    const rows = derive(run([{ claim: 1, article: 10, passage: 1, label: 'supports' }, ...none(10, [2, 3]), ...none(20), ...none(30)]), execution)
    expect(new Set(rows.map((r) => r.summary))).toEqual(new Set(['not_assessed']))
    expect(rows.every((r) => r.findings.length === 0)).toBe(true)
  })

  it('a completed assessment with no output at all is not assessed', () => {
    expect(new Set(derive({ ok: false, kind: 'no_result' }).map((r) => r.summary))).toEqual(new Set(['not_assessed']))
    expect(new Set(derive(undefined).map((r) => r.summary))).toEqual(new Set(['not_assessed']))
  })

  it('a completed assessment whose output was rejected is inconclusive for every article', () => {
    const rows = derive(run([{ claim: 99, article: 10, passage: 1, label: 'supports' }]))
    expect(new Set(rows.map((r) => r.summary))).toEqual(new Set(['inconclusive']))
    expect(rows.every((r) => r.findings.length === 0 && r.reasons.length === 0)).toBe(true)
  })

  it('an answer with no claims cannot be called "no support": it is not assessed', () => {
    const empty = buildSnapshot({ question: 'q', answer: '', articles: [{ id: 1, question: 'A', answer: 'Text.' }] })
    const rows = deriveArticleSupport(empty, { execution: COMPLETED, validation: { ok: true, findings: [], offTopic: [] } })
    expect(rows.map((r) => r.summary)).toEqual(['not_assessed'])
  })

  it('articles the snapshot left out are always not assessed, even when everything else was judged', () => {
    const big = buildSnapshot({
      question: 'q',
      answer: 'A claim here.',
      articles: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, question: `a${i}`, answer: 'Unrelated text.' })),
    })
    const findings = big.articles.map((a) => ({ claim: 1, article: a.id, passage: null, label: 'none' }))
    const validation = validateJudgeOutput(big, { findings, off_topic: [] })
    const rows = deriveArticleSupport(big, { execution: COMPLETED, validation })
    expect(rows).toHaveLength(10)
    expect(rows.slice(8).map((r) => [r.articleId, r.summary])).toEqual([[9, 'not_assessed'], [10, 'not_assessed']])
    expect(rows.slice(0, 8).every((r) => r.summary === 'no_support')).toBe(true)
  })

  it('across every combination of execution state and validation outcome, only a complete valid answer can produce supporting or no support', () => {
    const validations: Array<ValidationResult | undefined> = [
      undefined,
      { ok: false, kind: 'no_result' },
      { ok: false, kind: 'invalid', reasons: ['malformed'] },
      { ok: false, kind: 'invalid', reasons: ['unknown_claim', 'duplicate_finding'] },
    ]
    for (const execution of states) {
      for (const validation of validations) {
        for (const row of derive(validation, execution)) {
          expect(['supporting', 'no_support']).not.toContain(row.summary)
        }
      }
    }
  })
})

describe('answer-level state', () => {
  const art = (...summary: SupportSummary[]) => summary.map((s) => ({ summary: s }))

  it('supporting when any supplied article supports it', () => {
    expect(deriveAnswerSupport(COMPLETED, art('no_support', 'supporting', 'not_assessed'))).toBe('supporting')
  })

  it('inconclusive when none supports it and any is inconclusive', () => {
    expect(deriveAnswerSupport(COMPLETED, art('no_support', 'inconclusive'))).toBe('inconclusive')
    expect(deriveAnswerSupport(COMPLETED, art('inconclusive', 'not_assessed'))).toBe('inconclusive')
  })

  it('not assessed when an article was not checked, so it is never read as nothing supporting the answer', () => {
    expect(deriveAnswerSupport(COMPLETED, art('no_support', 'not_assessed'))).toBe('not_assessed')
  })

  it('no support only when every supplied article was checked and none supports the answer', () => {
    expect(deriveAnswerSupport(COMPLETED, art('no_support', 'no_support'))).toBe('no_support')
  })

  it('no support for an answer given no articles at all', () => {
    expect(deriveAnswerSupport(COMPLETED, [])).toBe('no_support')
  })

  it('not assessed unless the assessment completed, whatever the articles say', () => {
    const states: Execution[] = [
      { state: 'not_scheduled' },
      { state: 'pending' },
      { state: 'running' },
      { state: 'failed', reason: 'timeout' },
      { state: 'skipped', reason: 'over_budget' },
    ]
    for (const execution of states) {
      expect(deriveAnswerSupport(execution, art('supporting'))).toBe('not_assessed')
      expect(deriveAnswerSupport(execution, [])).toBe('not_assessed')
    }
  })
})
