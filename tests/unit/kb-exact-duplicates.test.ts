import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableColumns } from 'drizzle-orm'
import { kbArticles } from '@/lib/db/schema'
import { contentHash, normalizeForHash } from '@/lib/kb/revision'
import { dropExactDuplicates, isExactDuplicate } from '@/lib/kb/duplicates'
import { collapseExactSources, type SourceCandidate } from '@/lib/kb/answer-sources'

/**
 * "Exact" means the same question and answer once line endings and runs of
 * whitespace are ignored, which is the same fingerprint the history and the
 * verification feature use. These tests pin down both sides of that line: what
 * counts as the same, and what must never be mistaken for it.
 */

describe('what counts as an exact duplicate', () => {
  const base = { question: 'How do I reset my password?', answer: 'Use the reset link on the sign-in page.' }

  it('is the same words with different spacing, line endings or trailing whitespace', () => {
    expect(isExactDuplicate(base, { ...base, answer: '  Use the reset link\r\non the   sign-in page.\n\n' })).toBe(true)
    expect(isExactDuplicate(base, { ...base, question: 'How do I reset\tmy password?' })).toBe(true)
  })

  it.each([
    ['one word of the answer changed', { answer: 'Use the reset link on the login page.' }],
    ['a different question over the same answer', { question: 'How do I change my password?' }],
    ['different capitalisation', { answer: 'use the reset link on the sign-in page.' }],
    ['different punctuation', { answer: 'Use the reset link on the sign-in page' }],
    ['the answer with extra text after it', { answer: 'Use the reset link on the sign-in page. Then check your email.' }],
  ])('is not a duplicate when there is %s', (_label, change) => {
    expect(isExactDuplicate(base, { ...base, ...change })).toBe(false)
  })

  it('does not treat text moved between the question and the answer as the same', () => {
    expect(isExactDuplicate({ question: 'a b', answer: 'c' }, { question: 'a', answer: 'b c' })).toBe(false)
  })

  it('uses the same normalisation as the revision fingerprint', () => {
    expect(contentHash('q', 'a  b')).toBe(contentHash('q', normalizeForHash('a  b')))
  })
})

describe('dropExactDuplicates', () => {
  const art = (id: number, question: string, answer: string) => ({ id, question, answer })

  it('keeps the first (best ranked) copy and drops the rest, in order', () => {
    const out = dropExactDuplicates([art(1, 'q', 'a'), art(2, 'q', 'a'), art(3, 'other', 'b'), art(4, 'q', 'a ')])
    expect(out.map((x) => x.id)).toEqual([1, 3])
  })

  it('fills the limit with different articles when copies would have taken the slots', () => {
    const out = dropExactDuplicates(
      [art(1, 'q', 'a'), art(2, 'q', 'a'), art(3, 'q', 'a'), art(4, 'x', 'b'), art(5, 'y', 'c'), art(6, 'z', 'd')],
      3
    )
    expect(out.map((x) => x.id)).toEqual([1, 4, 5])
  })

  it('returns what it has when there are fewer different articles than the limit', () => {
    expect(dropExactDuplicates([art(1, 'q', 'a'), art(2, 'q', 'a')], 3).map((x) => x.id)).toEqual([1])
  })

  it('keeps articles that only share a title', () => {
    expect(dropExactDuplicates([art(1, 'q', 'a'), art(2, 'q', 'b')]).map((x) => x.id)).toEqual([1, 2])
  })
})

describe('collapseExactSources', () => {
  const src = (id: number | null, rank: number, status: SourceCandidate['source']['status'], recorded: string, current: string | null): SourceCandidate => ({
    source: { article_id: id, title: id === null ? null : `Article ${id}`, rank, status },
    recordedHash: recorded,
    currentHash: current,
  })

  it('shows one entry for articles supplied with identical text, and counts the rest as copies', () => {
    const out = collapseExactSources([
      src(11, 1, 'current', 'h1', 'h1'),
      src(12, 2, 'current', 'h1', 'h1'),
      src(13, 3, 'current', 'h1', 'h1'),
    ])
    expect(out).toEqual([{ article_id: 11, title: 'Article 11', rank: 1, status: 'current', copies: 2 }])
  })

  it('keeps different articles, in the order they were supplied', () => {
    const out = collapseExactSources([src(11, 1, 'current', 'h1', 'h1'), src(12, 2, 'current', 'h2', 'h2'), src(13, 3, 'current', 'h1', 'h1')])
    expect(out.map((s) => [s.article_id, s.copies])).toEqual([[11, 1], [12, 0]])
  })

  it('keeps the copy that can be linked when the first was deleted', () => {
    const out = collapseExactSources([src(null, 1, 'deleted', 'h1', null), src(12, 2, 'current', 'h1', 'h1')])
    expect(out).toEqual([{ article_id: 12, title: 'Article 12', rank: 2, status: 'current', copies: 1 }])
  })

  it('folds a deleted copy of an article into one entry', () => {
    const out = collapseExactSources([src(null, 1, 'deleted', 'h1', null), src(null, 2, 'deleted', 'h1', null)])
    expect(out).toEqual([{ article_id: null, title: null, rank: 1, status: 'deleted', copies: 1 }])
  })

  it('never links two live articles whose text is identical now, even if they differed when supplied', () => {
    // 12 was edited after the answer and now reads exactly like 11.
    const out = collapseExactSources([src(11, 1, 'current', 'h1', 'h1'), src(12, 2, 'changed', 'h0', 'h1')])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ article_id: 11, copies: 1 })
  })

  it('keeps an article that changed to something different as its own entry', () => {
    const out = collapseExactSources([src(11, 1, 'current', 'h1', 'h1'), src(12, 2, 'changed', 'h0', 'h9')])
    expect(out.map((s) => s.article_id)).toEqual([11, 12])
  })

  it('returns an empty list for no sources', () => {
    expect(collapseExactSources([])).toEqual([])
  })
})

// --- database side, through drizzle's pg-proxy driver: real SQL, scripted rows ---

type Call = { sql: string; params: unknown[] }
let calls: Call[]
let respond: (c: Call) => unknown[][]

const cols = Object.values(getTableColumns(kbArticles))
/** A full kb_articles row as the driver returns it: positional, vectors as text. */
const articleRow = (over: Record<string, unknown> = {}): unknown[] =>
  cols.map((col) =>
    col.name in over
      ? over[col.name]
      : col.name === 'id'
        ? 7
        : col.columnType === 'PgVector'
          ? '[0.1,0.2]'
          : col.dataType === 'number'
            ? 1
            : 'x'
  )

beforeEach(() => {
  calls = []
  respond = () => []
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    const call = { sql: sqlText.replace(/\s+/g, ' ').trim().toLowerCase(), params }
    calls.push(call)
    return { rows: respond(call) }
  })
  const db = Object.assign(Object.create(fakeDb), {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      calls.push({ sql: 'begin', params: [] })
      const out = await fn(fakeDb)
      calls.push({ sql: 'commit', params: [] })
      return out
    },
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
  vi.resetModules()
})

describe('findExactDuplicate', () => {
  it('looks only inside the workspace and narrows by the question with whitespace collapsed', async () => {
    const { findExactDuplicate } = await import('@/lib/db/queries/kb-duplicates')
    const { getDb } = await import('@/lib/db/drizzle')
    await findExactDuplicate(getDb(), 3, 'How   do I\nreset?', 'a')
    const q = calls[0]
    expect(q.sql).toContain('"kb_articles"."org_id" = $')
    expect(q.sql).toContain('regexp_replace')
    expect(q.params).toEqual(expect.arrayContaining([3, 'How do I reset?']))
  })

  it('sends Postgres the single-backslash whitespace escape, not a template-literal-mangled one', async () => {
    const { findExactDuplicate } = await import('@/lib/db/queries/kb-duplicates')
    const { getDb } = await import('@/lib/db/drizzle')
    await findExactDuplicate(getDb(), 3, 'q', 'a')
    // A lone `s` here (the backslash eaten by string escaping) would collapse the letter s instead of whitespace.
    expect(calls[0].sql).toContain("regexp_replace(\"kb_articles\".\"question\", '\\s+', ' ', 'g')")
  })

  it('returns the id of an article with exactly the same text, whatever its spacing', async () => {
    respond = () => [[9, 'How do I reset?', 'Use the   link.\r\n']]
    const { findExactDuplicate } = await import('@/lib/db/queries/kb-duplicates')
    const { getDb } = await import('@/lib/db/drizzle')
    expect(await findExactDuplicate(getDb(), 3, 'How do I reset?', 'Use the link.')).toBe(9)
  })

  it('returns null when the question matches but the answer differs', async () => {
    respond = () => [[9, 'How do I reset?', 'A different answer.']]
    const { findExactDuplicate } = await import('@/lib/db/queries/kb-duplicates')
    const { getDb } = await import('@/lib/db/drizzle')
    expect(await findExactDuplicate(getDb(), 3, 'How do I reset?', 'Use the link.')).toBeNull()
  })

  it('returns null when nothing in the workspace has that question', async () => {
    const { findExactDuplicate } = await import('@/lib/db/queries/kb-duplicates')
    const { getDb } = await import('@/lib/db/drizzle')
    expect(await findExactDuplicate(getDb(), 3, 'q', 'a')).toBeNull()
  })

  it('picks the matching article out of several with the same question', async () => {
    respond = () => [
      [8, 'q', 'one answer'],
      [9, 'q', 'the answer'],
    ]
    const { findExactDuplicate } = await import('@/lib/db/queries/kb-duplicates')
    const { getDb } = await import('@/lib/db/drizzle')
    expect(await findExactDuplicate(getDb(), 3, 'q', 'the answer')).toBe(9)
  })
})

describe('searchArticles with exact copies', () => {
  const row = (id: number, question: string, answer: string, distance: number) => [...articleRow({ id, question, answer }), distance]
  const searchRows = (rows: unknown[][]) => {
    respond = (c) => (c.sql.includes('pg_extension') ? [['0.8.0']] : c.sql.includes('set_config') ? [] : rows)
  }

  it('asks the database for more than the limit, so copies cannot use up the slots', async () => {
    searchRows([])
    const { searchArticles } = await import('@/lib/db/queries/kb')
    await searchArticles([0.1, 0.2], 3, 3)
    const select = calls.find((c) => c.sql.includes('from "kb_articles"') && c.sql.includes('limit'))!
    expect(select.params).toContain(9)
  })

  it('returns three different articles when the best three matches are one article copied three times', async () => {
    searchRows([
      row(1, 'Open Questions', 'Same body.', 0.1),
      row(2, 'Open Questions', 'Same body.', 0.1),
      row(3, 'Open Questions', 'Same body.', 0.1),
      row(4, 'Pricing', 'Plans start at $49.', 0.2),
      row(5, 'Billing', 'Invoices are monthly.', 0.3),
    ])
    const { searchArticles } = await import('@/lib/db/queries/kb')
    const out = await searchArticles([0.1, 0.2], 3, 3)
    expect(out.map((a) => a.id)).toEqual([1, 4, 5])
    expect(out[0].score).toBeCloseTo(0.9)
  })

  it('does not merge articles that only share a question', async () => {
    searchRows([row(1, 'Same title', 'First body.', 0.1), row(2, 'Same title', 'Second body.', 0.2)])
    const { searchArticles } = await import('@/lib/db/queries/kb')
    expect((await searchArticles([0.1, 0.2], 3, 3)).map((a) => a.id)).toEqual([1, 2])
  })

  it('hands the assistant each exact article once through getKBContext', async () => {
    searchRows([row(1, 'Q', 'A.', 0.1), row(2, 'Q', 'A.', 0.1), row(3, 'Other', 'B.', 0.2)])
    const { getKBContext } = await import('@/lib/db/queries/kb')
    expect((await getKBContext([0.1, 0.2], 3, 3)).map((c) => c.articleId)).toEqual([1, 3])
  })
})

describe('createArticle with rejectExactDuplicate', () => {
  const input = { question: 'q', answer: 'a', embedding: [0.1, 0.2], model: 'm', createdBy: 12 }

  it('refuses a new article whose exact text is already there, naming the existing one, and writes nothing', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[0]] : c.sql.includes('regexp_replace') ? [[9, 'q', 'a ']] : [articleRow()])
    const { createArticle } = await import('@/lib/db/queries/kb')
    const { DuplicateArticleError } = await import('@/lib/db/queries/kb-duplicates')
    const err = await createArticle(input, 3, 2000, true).catch((e) => e)
    expect(err).toBeInstanceOf(DuplicateArticleError)
    expect(err.existingId).toBe(9)
    expect(calls.some((c) => c.sql.startsWith('insert into'))).toBe(false)
  })

  it('adds the article when nothing matches', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[0]] : c.sql.includes('regexp_replace') ? [] : [articleRow({ id: 42 })])
    const { createArticle } = await import('@/lib/db/queries/kb')
    expect((await createArticle(input, 3, 2000, true)).id).toBe(42)
  })

  it('does not look for a duplicate unless asked to', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[0]] : [articleRow({ id: 42 })])
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle(input, 3, 2000)
    expect(calls.some((c) => c.sql.includes('regexp_replace'))).toBe(false)
  })

  it('checks after taking the workspace lock, so two adds at once cannot both pass', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[0]] : c.sql.includes('regexp_replace') ? [] : [articleRow({ id: 42 })])
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle(input, 3, 2000, true)
    const sqls = calls.map((c) => c.sql)
    const lock = sqls.findIndex((q) => q.includes('pg_advisory_xact_lock'))
    const lookup = sqls.findIndex((q) => q.includes('regexp_replace'))
    const insert = sqls.findIndex((q) => q.startsWith('insert into "kb_articles"'))
    expect(lock).toBeGreaterThan(-1)
    expect(lookup).toBeGreaterThan(lock)
    expect(insert).toBeGreaterThan(lookup)
  })
})
