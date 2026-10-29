import { describe, it, expect } from 'vitest'
import { contentHash } from '@/lib/kb/revision'
import { SUPPORT_LIMITS } from '@/lib/kb/support/limits'
import { articleOf, buildSnapshot, claimOf, hasWorkForJudge, passageOf, quoteOf } from '@/lib/kb/support/snapshot'

const article = (id: number, answer = `Body of article ${id}.`) => ({ id, question: `Article ${id}`, answer })

describe('buildSnapshot', () => {
  it('holds the question, numbered claims, and each article with its revision hash and passages', () => {
    const snap = buildSnapshot({
      question: 'How do I reset my password?',
      answer: 'Use the reset link. It expires in an hour.',
      articles: [article(7, 'Reset links expire after one hour.\n\nRequest a new one if it did.')],
    })
    expect(snap.question).toBe('How do I reset my password?')
    expect(snap.claims.map((c) => c.text)).toEqual(['Use the reset link.', 'It expires in an hour.'])
    expect(snap.articles).toHaveLength(1)
    expect(snap.articles[0]).toMatchObject({ id: 7, title: 'Article 7', truncated: false })
    expect(snap.articles[0].hash).toBe(contentHash('Article 7', 'Reset links expire after one hour.\n\nRequest a new one if it did.'))
    expect(snap.articles[0].passages.map((p) => p.text)).toEqual(['Reset links expire after one hour.', 'Request a new one if it did.'])
    expect(snap.omittedArticleIds).toEqual([])
  })

  it('is deeply frozen: nothing a judge-facing caller does can change what was assessed', () => {
    const snap = buildSnapshot({ question: 'q', answer: 'A claim here.', articles: [article(1)] })
    expect(Object.isFrozen(snap)).toBe(true)
    expect(Object.isFrozen(snap.claims)).toBe(true)
    expect(Object.isFrozen(snap.claims[0])).toBe(true)
    expect(Object.isFrozen(snap.articles[0])).toBe(true)
    expect(Object.isFrozen(snap.articles[0].passages)).toBe(true)
    expect(() => {
      ;(snap.claims[0] as { text: string }).text = 'changed'
    }).toThrow(TypeError)
    expect(() => {
      ;(snap.articles as unknown[]).push({})
    }).toThrow(TypeError)
  })

  it('is deterministic', () => {
    const input = { question: 'q', answer: 'One. Two.', articles: [article(1), article(2)] }
    expect(buildSnapshot(input)).toEqual(buildSnapshot(input))
  })

  it('counts a repeated article id once', () => {
    const snap = buildSnapshot({ question: 'q', answer: 'A claim.', articles: [article(3), article(3), article(4)] })
    expect(snap.articles.map((a) => a.id)).toEqual([3, 4])
  })

  it('keeps only the first maxArticles and lists the rest as omitted, in order', () => {
    const ids = Array.from({ length: SUPPORT_LIMITS.maxArticles + 3 }, (_, i) => i + 1)
    const snap = buildSnapshot({ question: 'q', answer: 'A claim.', articles: ids.map((id) => article(id)) })
    expect(snap.articles.map((a) => a.id)).toEqual(ids.slice(0, SUPPORT_LIMITS.maxArticles))
    expect(snap.omittedArticleIds).toEqual(ids.slice(SUPPORT_LIMITS.maxArticles))
  })

  it('bounds the question and never splits a surrogate pair', () => {
    const snap = buildSnapshot({ question: `${'q'.repeat(SUPPORT_LIMITS.maxQuestionChars - 1)}😀😀`, answer: 'A claim.', articles: [] })
    expect(snap.question).toHaveLength(SUPPORT_LIMITS.maxQuestionChars - 1)
  })

  it('flags an article whose passages were cut', () => {
    const body = Array.from({ length: SUPPORT_LIMITS.maxPassagesPerArticle + 5 }, (_, i) => `Paragraph ${i} text.`).join('\n\n')
    const snap = buildSnapshot({ question: 'q', answer: 'A claim.', articles: [article(1, body)] })
    expect(snap.articles[0].truncated).toBe(true)
    expect(snap.articles[0].passages).toHaveLength(SUPPORT_LIMITS.maxPassagesPerArticle)
  })

  it('flags an answer whose claims were cut', () => {
    const answer = Array.from({ length: SUPPORT_LIMITS.maxClaims + 4 }, (_, i) => `Claim ${i} here.`).join(' ')
    expect(buildSnapshot({ question: 'q', answer, articles: [] }).claimsTruncated).toBe(true)
  })
})

describe('hasWorkForJudge', () => {
  it('needs at least one claim and one article', () => {
    expect(hasWorkForJudge(buildSnapshot({ question: 'q', answer: 'A claim.', articles: [article(1)] }))).toBe(true)
    expect(hasWorkForJudge(buildSnapshot({ question: 'q', answer: '', articles: [article(1)] }))).toBe(false)
    expect(hasWorkForJudge(buildSnapshot({ question: 'q', answer: 'A claim.', articles: [] }))).toBe(false)
  })
})

describe('lookups and quotes', () => {
  const snap = buildSnapshot({ question: 'q', answer: 'First. Second.', articles: [article(9, 'Alpha.\n\nBeta.')] })

  it('finds claims, articles and passages by id and nothing else', () => {
    expect(claimOf(snap, 2)?.text).toBe('Second.')
    expect(claimOf(snap, 0)).toBeUndefined()
    expect(claimOf(snap, 3)).toBeUndefined()
    expect(articleOf(snap, 9)?.id).toBe(9)
    expect(articleOf(snap, 1)).toBeUndefined()
    expect(passageOf(articleOf(snap, 9)!, 2)?.text).toBe('Beta.')
    expect(passageOf(articleOf(snap, 9)!, 3)).toBeUndefined()
  })

  it('a quote is the snapshot text itself when short, and a prefix of it when long', () => {
    const [short] = snap.claims
    expect(quoteOf(short)).toBe('First.')
    const long = buildSnapshot({ question: 'q', answer: `${'word '.repeat(100).trim()}.`, articles: [] }).claims[0]
    const quote = quoteOf(long)
    expect(quote).toHaveLength(SUPPORT_LIMITS.maxQuoteChars)
    expect(long.text.startsWith(quote)).toBe(true)
  })

  it('does not cut a quote through a surrogate pair', () => {
    const piece = { index: 1, text: `${'a'.repeat(SUPPORT_LIMITS.maxQuoteChars - 1)}😀😀`, start: 0, end: 0, clipped: false }
    expect(quoteOf(piece)).toHaveLength(SUPPORT_LIMITS.maxQuoteChars - 1)
  })
})
