import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { contentHash } from '@/lib/kb/revision'
import { ANSWER_REFERENCE_RETENTION_DAYS } from '@/lib/kb/coverage'

/**
 * The answer-to-article reference queries, run through drizzle's pg-proxy
 * driver so the compiled SQL is real. Pins what is written and where: one
 * answer and its references in one transaction, a repeat of the same answer id
 * writing nothing, only articles from the workspace, the revision hash taken
 * from the stored article, and every read scoped to the workspace. The
 * statements were also run against a real Postgres when the tables were added.
 */

type Call = { sql: string; params: unknown[] }
let calls: Call[]
let respond: (c: Call) => unknown[][]

const ANSWER = '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44'

beforeEach(() => {
  calls = []
  respond = () => []
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    const call = { sql: sqlText.replace(/\s+/g, ' ').trim().toLowerCase(), params }
    calls.push(call)
    return { rows: respond(call) }
  })
  // The proxy driver has no transactions; run the callback on the same scripted
  // connection and record BEGIN/COMMIT so tests can see what ran inside.
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

const inserts = (table: string) => calls.filter((c) => c.sql.startsWith(`insert into "${table}"`))
const base = { answerId: ANSWER, orgId: 7, surface: 'widget' as const, outcome: 'generated' as const }

/** Scripts the answer insert to succeed and the article lookup to return the given articles. */
function scripted(articles: Array<[number, string, string]>, answerInserted = true) {
  respond = (c) => {
    if (c.sql.startsWith('insert into "kb_answers"')) return answerInserted ? [[ANSWER]] : []
    if (c.sql.startsWith('select') && c.sql.includes('from "kb_articles"')) return articles
    return []
  }
}

describe('recordAnswerReferences input checks', () => {
  it.each(['', 'not-a-uuid', '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e4', `${ANSWER}; drop table kb_answers`])(
    'refuses the answer id %j and touches nothing',
    async (answerId) => {
      const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
      await expect(recordAnswerReferences({ ...base, answerId, references: [] })).rejects.toThrow(/uuid/i)
      expect(calls).toHaveLength(0)
    }
  )

  it('refuses a surface or outcome it does not know', async () => {
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await expect(recordAnswerReferences({ ...base, surface: 'email' as never, references: [] })).rejects.toThrow(/surface/)
    await expect(recordAnswerReferences({ ...base, outcome: 'maybe' as never, references: [] })).rejects.toThrow(/outcome/)
    expect(calls).toHaveLength(0)
  })
})

describe('recordAnswerReferences', () => {
  it('writes the answer and its references in one transaction', async () => {
    scripted([[11, 'How do I reset?', 'Use the link.']])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    expect(await recordAnswerReferences({ ...base, references: [{ articleId: 11, rank: 1, score: 0.9 }] })).toEqual({ recorded: true })
    const verbs = calls.map((c) => c.sql.split(' ').slice(0, 3).join(' '))
    expect(verbs[0]).toBe('begin')
    expect(verbs.at(-1)).toBe('commit')
    expect(inserts('kb_answers')).toHaveLength(1)
    expect(inserts('kb_answer_references')).toHaveLength(1)
  })

  it('records the answer once: a repeat of the same id inserts nothing and returns recorded false', async () => {
    scripted([[11, 'q', 'a']], false)
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    expect(await recordAnswerReferences({ ...base, references: [{ articleId: 11, rank: 1 }] })).toEqual({ recorded: false })
    expect(inserts('kb_answers')[0].sql).toContain('on conflict ("id") do nothing')
    expect(inserts('kb_answer_references')).toHaveLength(0)
    // The articles are not even read once the answer is known to be a repeat.
    expect(calls.some((c) => c.sql.includes('from "kb_articles"'))).toBe(false)
  })

  it('stores the surface, outcome and workspace of the answer and nothing about its text', async () => {
    scripted([])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({ ...base, surface: 'agent_api', outcome: 'failed', references: [] })
    const answer = inserts('kb_answers')[0]
    expect(answer.params).toEqual(expect.arrayContaining([ANSWER, 7, 'agent_api', 'failed']))
    expect(answer.sql).toMatch(/insert into "kb_answers" \("id", "org_id", "surface", "outcome", "created_at"\)/)
  })

  it('looks articles up under the workspace, so an id from another workspace is never recorded', async () => {
    scripted([[11, 'q', 'a']])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({ ...base, references: [{ articleId: 11, rank: 1 }, { articleId: 99, rank: 2 }] })
    const lookup = calls.find((c) => c.sql.startsWith('select') && c.sql.includes('from "kb_articles"'))!
    expect(lookup.sql).toContain('"kb_articles"."org_id" = $')
    expect(lookup.params).toEqual(expect.arrayContaining([7, 11, 99]))
    // Only the article the lookup returned is written.
    const written = inserts('kb_answer_references')[0].params
    expect(written).toContain(11)
    expect(written).not.toContain(99)
  })

  it('takes the revision hash from the stored article, not from the caller', async () => {
    scripted([[11, 'How do I reset?', 'Use the link.']])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({ ...base, references: [{ articleId: 11, rank: 3, score: 0.5 }] })
    const written = inserts('kb_answer_references')[0].params
    expect(written).toEqual([ANSWER, 11, contentHash('How do I reset?', 'Use the link.'), 3, 0.5])
  })

  it('counts an article once per answer and keeps its best rank', async () => {
    scripted([[11, 'q', 'a']])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({
      ...base,
      references: [{ articleId: 11, rank: 4 }, { articleId: 11, rank: 2 }, { articleId: 11, rank: 3 }],
    })
    const lookup = calls.find((c) => c.sql.includes('from "kb_articles"'))!
    expect(lookup.params.filter((p) => p === 11)).toHaveLength(1)
    const written = inserts('kb_answer_references')[0].params
    expect(written.filter((p) => p === 11)).toHaveLength(1)
    expect(written).toContain(2)
    expect(written).not.toContain(4)
  })

  it('stores a missing score as null', async () => {
    scripted([[11, 'q', 'a']])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({ ...base, references: [{ articleId: 11, rank: 1 }] })
    expect(inserts('kb_answer_references')[0].params.at(-1)).toBeNull()
  })

  it('ignores ids and ranks that are not whole numbers, and negative ranks', async () => {
    scripted([[11, 'q', 'a']])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({
      ...base,
      references: [
        { articleId: 1.5, rank: 1 },
        { articleId: 12, rank: 1.5 },
        { articleId: 13, rank: -1 },
        { articleId: 11, rank: 0 },
      ],
    })
    const lookup = calls.find((c) => c.sql.includes('from "kb_articles"'))!
    expect(lookup.params).toContain(11)
    expect(lookup.params).not.toContain(12)
    expect(lookup.params).not.toContain(13)
  })

  it('records an answer with no references (nothing was supplied) without reading any article', async () => {
    scripted([])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    expect(await recordAnswerReferences({ ...base, references: [] })).toEqual({ recorded: true })
    expect(inserts('kb_answers')).toHaveLength(1)
    expect(inserts('kb_answer_references')).toHaveLength(0)
    expect(calls.some((c) => c.sql.includes('from "kb_articles"'))).toBe(false)
  })

  it('writes no reference rows when none of the articles belong to the workspace', async () => {
    scripted([])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    expect(await recordAnswerReferences({ ...base, references: [{ articleId: 99, rank: 1 }] })).toEqual({ recorded: true })
    expect(inserts('kb_answer_references')).toHaveLength(0)
  })
})

describe('getReferencesForAnswer', () => {
  it('reads nothing for an id that is not a UUID', async () => {
    const { getReferencesForAnswer } = await import('@/lib/db/queries/kb-answers')
    expect(await getReferencesForAnswer('nope', 7)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('is null for an answer that is not in the workspace, and reads no references', async () => {
    respond = () => []
    const { getReferencesForAnswer } = await import('@/lib/db/queries/kb-answers')
    expect(await getReferencesForAnswer(ANSWER, 7)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('"kb_answers"."org_id" = $')
    expect(calls[0].params).toEqual(expect.arrayContaining([ANSWER, 7]))
  })

  it('returns the answer with its references, lowest rank first, with a deleted article as null', async () => {
    respond = (c) =>
      c.sql.includes('from "kb_answers"')
        ? [[ANSWER, 7, 'widget', 'generated', '2026-10-25T10:00:00+00:00']]
        : [
            [1, ANSWER, 11, 'h1', 1, 0.9],
            [2, ANSWER, null, 'h2', 2, null],
          ]
    const { getReferencesForAnswer } = await import('@/lib/db/queries/kb-answers')
    expect(await getReferencesForAnswer(ANSWER, 7)).toEqual({
      id: ANSWER,
      surface: 'widget',
      outcome: 'generated',
      created_at: '2026-10-25T10:00:00+00:00',
      references: [
        { article_id: 11, article_content_hash: 'h1', rank: 1, score: 0.9 },
        { article_id: null, article_content_hash: 'h2', rank: 2, score: null },
      ],
    })
    expect(calls[1].sql).toMatch(/order by "kb_answer_references"\."rank", "kb_answer_references"\."id"/)
  })
})

describe('getRecentAnswersForArticle', () => {
  it('is scoped to the workspace through the answer and returns newest first', async () => {
    respond = () => [
      [ANSWER, 'widget', 'generated', '2026-10-25T10:00:00+00:00', 1, 0.9, 'h1'],
      ['3f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44', 'discord', 'failed', '2026-10-24T10:00:00+00:00', 2, null, 'h1'],
    ]
    const { getRecentAnswersForArticle } = await import('@/lib/db/queries/kb-answers')
    const out = await getRecentAnswersForArticle(11, 7)
    expect(out).toEqual([
      { answer_id: ANSWER, surface: 'widget', outcome: 'generated', created_at: '2026-10-25T10:00:00+00:00', rank: 1, score: 0.9, article_content_hash: 'h1' },
      { answer_id: '3f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44', surface: 'discord', outcome: 'failed', created_at: '2026-10-24T10:00:00+00:00', rank: 2, score: null, article_content_hash: 'h1' },
    ])
    const q = calls[0]
    expect(q.sql).toContain('inner join "kb_answers"')
    expect(q.sql).toContain('"kb_answers"."org_id" = $')
    expect(q.sql).toMatch(/order by "kb_answers"\."created_at" desc, "kb_answer_references"\."id" desc/)
    expect(q.params).toEqual(expect.arrayContaining([11, 7]))
  })

  it.each([
    [undefined, 20],
    [5, 5],
    [0, 1],
    [-4, 1],
    [1000, 100],
    [7.9, 7],
  ])('limit %s is applied as %s', async (limit, applied) => {
    const { getRecentAnswersForArticle } = await import('@/lib/db/queries/kb-answers')
    await getRecentAnswersForArticle(11, 7, limit as number | undefined)
    expect(calls[0].params.at(-1)).toBe(applied)
  })
})

describe('pruneAnswerReferences', () => {
  it('deletes answers past the retention window (their references go with them) and reports how many', async () => {
    respond = () => [[1], [1], [1]]
    const { pruneAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    expect(await pruneAnswerReferences()).toBe(3)
    const q = calls[0]
    expect(q.sql).toMatch(/delete from kb_answers where created_at < now\(\) - make_interval\(days => \$1::int\) returning 1/)
    expect(q.params).toEqual([ANSWER_REFERENCE_RETENTION_DAYS])
  })

  it('keeps 90 days by default and honours a different window', async () => {
    const { pruneAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    expect(ANSWER_REFERENCE_RETENTION_DAYS).toBe(90)
    await pruneAnswerReferences(30)
    expect(calls[0].params).toEqual([30])
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a retention of %s rather than deleting everything', async (days) => {
    const { pruneAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await expect(pruneAnswerReferences(days)).rejects.toThrow(/positive integer/)
    expect(calls).toHaveLength(0)
  })

  it('returns 0 when nothing is past retention', async () => {
    respond = () => []
    const { pruneAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    expect(await pruneAnswerReferences()).toBe(0)
  })
})
