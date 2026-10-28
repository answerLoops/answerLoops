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
    expect(answer.sql).toMatch(/insert into "kb_answers" \("id", "org_id", "surface", "outcome", "ticket_id", "created_at"\)/)
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
        ? [[ANSWER, 7, 'widget', 'generated', null, '2026-10-25T10:00:00+00:00']]
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

describe('recordAnswerReferences ticket link', () => {
  const ticketBase = { ...base, surface: 'ticket' as const }

  it('keeps the ticket id for a ticket draft, after checking it belongs to the workspace', async () => {
    respond = (c) => {
      if (c.sql.startsWith('insert into "kb_answers"')) return [[ANSWER]]
      if (c.sql.includes('from "tickets"')) return [[42]]
      return []
    }
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({ ...ticketBase, ticketId: 42, references: [] })
    const lookup = calls.find((c) => c.sql.includes('from "tickets"'))!
    expect(lookup.sql).toContain('"tickets"."org_id" = $')
    expect(lookup.params).toEqual(expect.arrayContaining([42, 7]))
    expect(inserts('kb_answers')[0].params).toContain(42)
  })

  it('stores no ticket when the ticket is not in the workspace', async () => {
    respond = (c) => (c.sql.startsWith('insert into "kb_answers"') ? [[ANSWER]] : [])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({ ...ticketBase, ticketId: 99, references: [] })
    expect(inserts('kb_answers')[0].params).not.toContain(99)
    expect(inserts('kb_answers')[0].params).toContain(null)
  })

  it.each(['widget', 'discord', 'agent_api'] as const)('ignores a ticket id on the %s surface, and does not even look it up', async (surface) => {
    respond = (c) => (c.sql.startsWith('insert into "kb_answers"') ? [[ANSWER]] : [])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({ ...base, surface, ticketId: 42, references: [] })
    expect(calls.some((c) => c.sql.includes('from "tickets"'))).toBe(false)
    expect(inserts('kb_answers')[0].params).not.toContain(42)
  })

  it('does not look anything up when there is no ticket id, or it is not a whole number', async () => {
    respond = (c) => (c.sql.startsWith('insert into "kb_answers"') ? [[ANSWER]] : [])
    const { recordAnswerReferences } = await import('@/lib/db/queries/kb-answers')
    await recordAnswerReferences({ ...ticketBase, references: [] })
    await recordAnswerReferences({ ...ticketBase, answerId: '3f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44', ticketId: 1.5, references: [] })
    expect(calls.some((c) => c.sql.includes('from "tickets"'))).toBe(false)
  })
})

describe('getAnswerSourcesForTicket', () => {
  const Q = 'How do I reset my password?'
  const A = 'Use the reset link.'
  const HASH = contentHash(Q, A)

  /** answer row, then the source rows: article id, stored hash, rank, question, answer, published. */
  function scriptedTicket(sources: unknown[][], answerRow: unknown[] | null = [ANSWER, 7, 'ticket', 'generated', 42, '2026-10-25T10:00:00+00:00']) {
    respond = (c) => (c.sql.includes('from "kb_answers"') && !c.sql.includes('kb_answer_references') ? (answerRow ? [answerRow] : []) : sources)
  }

  it('is null when the ticket has no recorded answer, and reads no sources', async () => {
    scriptedTicket([], null)
    const { getAnswerSourcesForTicket } = await import('@/lib/db/queries/kb-answers')
    expect(await getAnswerSourcesForTicket(42, 7)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('reads the newest answer for the ticket, scoped to the workspace', async () => {
    scriptedTicket([])
    const { getAnswerSourcesForTicket } = await import('@/lib/db/queries/kb-answers')
    await getAnswerSourcesForTicket(42, 7)
    const q = calls[0]
    expect(q.sql).toContain('"kb_answers"."ticket_id" = $')
    expect(q.sql).toContain('"kb_answers"."org_id" = $')
    expect(q.sql).toMatch(/order by "kb_answers"\."created_at" desc limit/)
    expect(q.params).toEqual(expect.arrayContaining([42, 7]))
  })

  it('joins the articles under the workspace too, so another workspace\'s article reads as deleted', async () => {
    scriptedTicket([])
    const { getAnswerSourcesForTicket } = await import('@/lib/db/queries/kb-answers')
    await getAnswerSourcesForTicket(42, 7)
    const refs = calls[1]
    expect(refs.sql).toContain('left join "kb_articles"')
    expect(refs.sql).toMatch(/"kb_articles"\."org_id" = \$/)
    expect(refs.sql).toMatch(/order by "kb_answer_references"\."rank", "kb_answer_references"\."id"/)
  })

  // Each article gets its own text, so the sources are different from one another.
  const art = (n: number) => ({ q: `Question ${n}`, a: `Answer ${n}`, hash: contentHash(`Question ${n}`, `Answer ${n}`) })

  it('gives current, changed, unpublished and deleted sources in rank order, each with its status', async () => {
    scriptedTicket([
      [11, art(1).hash, 1, art(1).q, art(1).a, 1], // unchanged and live
      [12, art(2).hash, 2, art(2).q, `${art(2).a} Edited.`, 1], // edited since
      [13, art(3).hash, 3, art(3).q, art(3).a, 0], // no longer live
      [null, art(4).hash, 4, null, null, null], // article deleted (join found nothing)
    ])
    const { getAnswerSourcesForTicket } = await import('@/lib/db/queries/kb-answers')
    expect(await getAnswerSourcesForTicket(42, 7)).toEqual({
      answer_id: ANSWER,
      outcome: 'generated',
      created_at: '2026-10-25T10:00:00+00:00',
      sources: [
        { article_id: 11, title: art(1).q, rank: 1, status: 'current', copies: 0 },
        { article_id: 12, title: art(2).q, rank: 2, status: 'changed', copies: 0 },
        { article_id: 13, title: art(3).q, rank: 3, status: 'unpublished', copies: 0 },
        { article_id: null, title: null, rank: 4, status: 'deleted', copies: 0 },
      ],
    })
  })

  it('lists three identical copies of one article once, links the first, and says how many more were supplied', async () => {
    scriptedTicket([
      [11, HASH, 1, Q, A, 1],
      [12, HASH, 2, Q, A, 1],
      [13, HASH, 3, Q, A, 1],
    ])
    const { getAnswerSourcesForTicket } = await import('@/lib/db/queries/kb-answers')
    const out = await getAnswerSourcesForTicket(42, 7)
    expect(out!.sources).toEqual([{ article_id: 11, title: Q, rank: 1, status: 'current', copies: 2 }])
  })

  it('keeps different articles apart even when they share a title', async () => {
    scriptedTicket([
      [11, HASH, 1, Q, A, 1],
      [12, art(2).hash, 2, Q, art(2).a, 1],
    ])
    const { getAnswerSourcesForTicket } = await import('@/lib/db/queries/kb-answers')
    const out = await getAnswerSourcesForTicket(42, 7)
    expect(out!.sources.map((x) => [x.article_id, x.copies])).toEqual([[11, 0], [12, 0]])
  })

  it('returns only the article title, never the article body or anything from the conversation', async () => {
    scriptedTicket([[11, HASH, 1, Q, A, 1]])
    const { getAnswerSourcesForTicket } = await import('@/lib/db/queries/kb-answers')
    const out = await getAnswerSourcesForTicket(42, 7)
    expect(JSON.stringify(out)).not.toContain(A)
    expect(Object.keys(out!.sources[0]).sort()).toEqual(['article_id', 'copies', 'rank', 'status', 'title'])
  })

  it('reports a failed draft as failed, with the sources that were supplied', async () => {
    scriptedTicket([[11, HASH, 1, Q, A, 1]], [ANSWER, 7, 'ticket', 'failed', 42, '2026-10-25T10:00:00+00:00'])
    const { getAnswerSourcesForTicket } = await import('@/lib/db/queries/kb-answers')
    const out = await getAnswerSourcesForTicket(42, 7)
    expect(out!.outcome).toBe('failed')
    expect(out!.sources).toHaveLength(1)
  })

  it('returns an empty list for a draft that had no articles supplied', async () => {
    scriptedTicket([])
    const { getAnswerSourcesForTicket } = await import('@/lib/db/queries/kb-answers')
    expect((await getAnswerSourcesForTicket(42, 7))!.sources).toEqual([])
  })
})

describe('getArticleAnswerView', () => {
  const Q = 'How do I reset my password?'
  const A = 'Use the reset link.'
  const NOW = contentHash(Q, A)
  const OLD = contentHash(Q, 'An older answer.')

  it('is null for an article that is not in the workspace, and reads no answers', async () => {
    respond = () => []
    const { getArticleAnswerView } = await import('@/lib/db/queries/kb-answers')
    expect(await getArticleAnswerView(11, 7)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('"kb_articles"."org_id" = $')
    expect(calls[0].params).toEqual(expect.arrayContaining([11, 7]))
  })

  it('marks an answer earlier when the article has changed since, and current when it has not', async () => {
    respond = (c) =>
      c.sql.includes('from "kb_articles"') && !c.sql.includes('kb_answer_references')
        ? [[Q, A]]
        : [
            [ANSWER, 'widget', 'generated', '2026-10-25T10:00:00+00:00', 1, null, NOW],
            ['3f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44', 'discord', 'failed', '2026-10-24T10:00:00+00:00', 2, null, OLD],
          ]
    const { getArticleAnswerView } = await import('@/lib/db/queries/kb-answers')
    const out = await getArticleAnswerView(11, 7)
    expect(out!.map((a) => [a.surface, a.outcome, a.revision])).toEqual([
      ['widget', 'generated', 'current'],
      ['discord', 'failed', 'earlier'],
    ])
  })

  it('returns an empty list for an article no answer was supplied to', async () => {
    respond = (c) => (c.sql.includes('from "kb_articles"') && !c.sql.includes('kb_answer_references') ? [[Q, A]] : [])
    const { getArticleAnswerView } = await import('@/lib/db/queries/kb-answers')
    expect(await getArticleAnswerView(11, 7)).toEqual([])
  })
})
