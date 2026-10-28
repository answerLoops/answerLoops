import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableColumns } from 'drizzle-orm'
import { kbArticles } from '@/lib/db/schema'
import { contentHash } from '@/lib/kb/revision'

/**
 * The article history log (kb_article_events), driven through drizzle's
 * pg-proxy driver so the compiled statements are real. Pins which event each
 * path writes, with which actor and origin, that it commits in the same
 * transaction as the change, and that nothing is written when the change is
 * refused or did not happen.
 */

type Call = { sql: string; params: unknown[] }

let calls: Call[]
let respond: (c: Call) => unknown[][]

function install() {
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
}

/** A full kb_articles row as the driver returns it: positional, vectors as text. */
const articleRow = (id: number): unknown[] =>
  Object.values(getTableColumns(kbArticles)).map((col) =>
    col.name === 'id' ? id : col.columnType === 'PgVector' ? '[0.1,0.2]' : col.dataType === 'number' ? 1 : 'x'
  )

/** Maps each column of a compiled INSERT on `table` to its value ('default' when omitted). */
function insertedInto(table: string, c: Call): Record<string, unknown> {
  const m = c.sql.match(new RegExp(`^insert into "${table}" \\((.*?)\\) values \\((.*?)\\)(?: returning.*)?$`))
  if (!m) throw new Error(`not an insert into ${table}: ${c.sql}`)
  const cols = m[1].split(', ').map((s) => s.replace(/"/g, ''))
  const vals = m[2].split(', ')
  return Object.fromEntries(
    cols.map((col, i) => {
      const p = vals[i].match(/^\$(\d+)$/)
      return [col, p ? c.params[Number(p[1]) - 1] : vals[i]]
    })
  )
}

const eventInserts = () => calls.filter((c) => c.sql.startsWith('insert into "kb_article_events"'))
const event = () => {
  const all = eventInserts()
  expect(all).toHaveLength(1)
  return insertedInto('kb_article_events', all[0])
}
const noEvents = () => expect(eventInserts()).toHaveLength(0)
const verbs = () => calls.map((c) => c.sql.split(' ').slice(0, 3).join(' '))

const article = { question: 'How do I reset?', answer: 'Use the link.', embedding: [0.1, 0.2], model: 'm' }

beforeEach(() => {
  calls = []
  respond = () => [articleRow(42)]
  install()
})

describe('createArticle events', () => {
  it('records a hand-written article as created, by the acting user', async () => {
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, createdBy: 12 }, 3)
    expect(event()).toMatchObject({
      org_id: 3,
      article_id: 42,
      type: 'created',
      actor_user_id: 12,
      origin: 'manual',
      content_hash: contentHash(article.question, article.answer),
    })
    expect(event().source_ticket_id).toBeNull()
  })

  it('records an article written from a ticket as promoted, linked to the ticket', async () => {
    respond = (c) => (c.sql.startsWith('select') ? [] : [articleRow(42)])
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, sourceTicketId: 9, createdBy: 12 }, 3)
    expect(event()).toMatchObject({ type: 'promoted', origin: 'ticket_promotion', actor_user_id: 12, source_ticket_id: 9 })
  })

  it('writes the article and its event inside one transaction, event last', async () => {
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, createdBy: 12 }, 3)
    expect(verbs()).toEqual(['begin', 'insert into "kb_articles"', 'insert into "kb_article_events"', 'commit'])
  })

  it('records a refresh that changes the words as an edit by the acting user, keeping the ticket link', async () => {
    respond = (c) => (c.sql.startsWith('select "id", "question"') ? [[7, 'old q', 'old a']] : [articleRow(7)])
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, sourceTicketId: 9, createdBy: 99 }, 3)
    expect(event()).toMatchObject({
      article_id: 7,
      type: 'edited',
      actor_user_id: 99,
      origin: 'ticket_promotion',
      source_ticket_id: 9,
      content_hash: contentHash(article.question, article.answer),
    })
    expect(verbs()).toEqual(['begin', expect.stringMatching(/^select/), expect.stringMatching(/^update/), 'insert into "kb_article_events"', expect.stringMatching(/^select/), 'commit'])
  })

  it('records nothing when a refresh leaves the words unchanged, even if only whitespace differs', async () => {
    respond = (c) =>
      c.sql.startsWith('select "id", "question"') ? [[7, `  ${article.question}\n`, article.answer.replace(' ', '   ')]] : [articleRow(7)]
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, sourceTicketId: 9, createdBy: 99 }, 3)
    expect(calls.some((c) => c.sql.startsWith('update "kb_articles"'))).toBe(true)
    noEvents()
  })

  it('writes no event when the workspace is at its article limit', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[2000]] : [articleRow(42)])
    const { createArticle } = await import('@/lib/db/queries/kb')
    const { ArticleCapReachedError } = await import('@/lib/db/queries/kb-article-cap')
    await expect(createArticle({ ...article, createdBy: 12 }, 3, 2000)).rejects.toBeInstanceOf(ArticleCapReachedError)
    expect(calls.some((c) => c.sql.startsWith('insert'))).toBe(false)
    noEvents()
  })

  it('writes no event and no commit when the article insert fails', async () => {
    respond = (c) => {
      if (c.sql.startsWith('insert into "kb_articles"')) throw new Error('insert failed')
      return []
    }
    const { createArticle } = await import('@/lib/db/queries/kb')
    await expect(createArticle(article, 3)).rejects.toThrow()
    noEvents()
    expect(verbs()).not.toContain('commit')
  })
})

describe('source article events', () => {
  const fromSource = { ...article, sourceId: 5, sourcePage: 1 }

  it('a sync-created article is recorded as created by the sync, with no actor', async () => {
    const { createArticleFromSource } = await import('@/lib/db/queries/kb')
    await createArticleFromSource(fromSource, 3)
    expect(event()).toMatchObject({ org_id: 3, article_id: 42, type: 'created', origin: 'sync', content_hash: contentHash(article.question, article.answer) })
    expect(event().actor_user_id).toBeNull()
    expect(verbs()).toEqual(['begin', 'insert into "kb_articles"', 'insert into "kb_article_events"', 'commit'])
  })

  it('an upload or URL import is recorded as created by the import, with no actor', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[0]] : c.sql.includes('regexp_replace') ? [] : [[42]])
    const { createArticleFromSourceWithinCap } = await import('@/lib/db/queries/kb-article-cap')
    await expect(createArticleFromSourceWithinCap(fromSource, 3, 2000)).resolves.toEqual({ id: 42 })
    expect(event()).toMatchObject({ article_id: 42, type: 'created', origin: 'import' })
    expect(event().actor_user_id).toBeNull()
  })

  it('an import refused at the article limit writes nothing', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[2000]] : [[42]])
    const { createArticleFromSourceWithinCap } = await import('@/lib/db/queries/kb-article-cap')
    await expect(createArticleFromSourceWithinCap(fromSource, 3, 2000)).resolves.toBeNull()
    noEvents()
  })

  // The page lookup returns a full row; question and answer are columns 3 and 4.
  const existingPage = (q: string, a: string) => (c: Call) => {
    const row = articleRow(7)
    row[2] = q
    row[3] = a
    return c.sql.includes('"source_page"') && c.sql.startsWith('select') ? [row] : [articleRow(7)]
  }

  it('a sync that changes a page records an automated edit', async () => {
    respond = existingPage('old q', 'old a')
    const { upsertArticleFromSource } = await import('@/lib/db/queries/kb')
    await upsertArticleFromSource(fromSource, 3)
    expect(event()).toMatchObject({ article_id: 7, type: 'edited', origin: 'sync', content_hash: contentHash(article.question, article.answer) })
    expect(event().actor_user_id).toBeNull()
  })

  it('a sync that rewrites an unchanged page records nothing', async () => {
    respond = existingPage(article.question, article.answer)
    const { upsertArticleFromSource } = await import('@/lib/db/queries/kb')
    await upsertArticleFromSource(fromSource, 3)
    expect(calls.some((c) => c.sql.startsWith('update "kb_articles"'))).toBe(true)
    noEvents()
  })

  it('a sync that finds a new page records it as created', async () => {
    respond = (c) => (c.sql.startsWith('select') ? [] : [articleRow(42)])
    const { upsertArticleFromSource } = await import('@/lib/db/queries/kb')
    await upsertArticleFromSource(fromSource, 3)
    expect(event()).toMatchObject({ type: 'created', origin: 'sync' })
  })
})

describe('review approval event', () => {
  const approve = { id: 5, question: 'edited q', answer: 'edited a', embedding: [0.1], model: 'm', reviewedBy: 12, cap: 2000 }

  it('records the approval with the reviewer, the review item and its source ticket', async () => {
    respond = (c) => {
      if (c.sql.startsWith('update "kb_review_items"') && c.sql.includes('returning')) return [[5, 31]]
      if (c.sql.startsWith('insert into "kb_articles"')) return [[321]]
      if (c.sql.includes('count(*)')) return [[10]]
      return []
    }
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await approveReviewItem(approve, 3)).toEqual({ ok: true, articleId: 321 })
    expect(event()).toMatchObject({
      org_id: 3,
      article_id: 321,
      type: 'review_approved',
      actor_user_id: 12,
      origin: 'review_queue',
      review_item_id: 5,
      source_ticket_id: 31,
      content_hash: contentHash('edited q', 'edited a'),
    })
    const seq = verbs()
    expect(seq[0]).toBe('begin')
    expect(seq.at(-1)).toBe('commit')
    expect(seq.indexOf('insert into "kb_article_events"')).toBeGreaterThan(seq.indexOf('insert into "kb_articles"'))
  })

  it('writes no event when the item was already resolved', async () => {
    respond = (c) => (c.sql.startsWith('select') ? [[5]] : [])
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await approveReviewItem(approve, 3)).toEqual({ ok: false, reason: 'not_pending' })
    noEvents()
  })

  it('writes no event when the workspace is at its article limit', async () => {
    respond = (c) => {
      if (c.sql.startsWith('update "kb_review_items"') && c.sql.includes('returning')) return [[5, null]]
      if (c.sql.includes('count(*)')) return [[2000]]
      return []
    }
    const { approveReviewItem } = await import('@/lib/db/queries/kb-review')
    const { ArticleCapReachedError } = await import('@/lib/db/queries/kb-article-cap')
    await expect(approveReviewItem(approve, 3)).rejects.toBeInstanceOf(ArticleCapReachedError)
    noEvents()
  })
})

describe('review rejection and reopening events', () => {
  it('reopening keeps the rejection: each decision is its own event', async () => {
    respond = (c) => (c.sql.startsWith('update') ? [[5]] : [])
    const { rejectReviewItem, reopenReviewItem } = await import('@/lib/db/queries/kb-review')
    await rejectReviewItem(5, 3, 12)
    await reopenReviewItem(5, 3, 14)
    const events = eventInserts().map((c) => insertedInto('kb_article_events', c))
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'review_rejected', actor_user_id: 12, review_item_id: 5, origin: 'review_queue' })
    expect(events[1]).toMatchObject({ type: 'review_reopened', actor_user_id: 14, review_item_id: 5, origin: 'review_queue' })
    // no article exists yet, so the events hang off the review item
    expect(events[0].article_id).toBeNull()
    expect(events[1].article_id).toBeNull()
  })

  it('writes no event when the item is not in the expected state', async () => {
    respond = (c) => (c.sql.startsWith('select') ? [[5]] : [])
    const { rejectReviewItem } = await import('@/lib/db/queries/kb-review')
    expect(await rejectReviewItem(5, 3, 12)).toEqual({ ok: false, reason: 'not_pending' })
    noEvents()
  })
})

describe('getArticleEvents', () => {
  it('reads the workspace history newest first, including the review item that produced the article', async () => {
    respond = () => [
      [8, 3, 7, 'edited', 12, 'ticket_promotion', 9, null, 'h2', '2026-10-21T10:00:00Z'],
      [7, 3, null, 'review_rejected', null, 'review_queue', null, 5, null, '2026-10-20T10:00:00Z'],
    ]
    const { getArticleEvents } = await import('@/lib/db/queries/kb-events')
    const out = await getArticleEvents(7, 3)
    expect(out).toEqual([
      { id: 8, article_id: 7, type: 'edited', actor_user_id: 12, origin: 'ticket_promotion', source_ticket_id: 9, review_item_id: null, content_hash: 'h2', created_at: '2026-10-21T10:00:00Z' },
      { id: 7, article_id: null, type: 'review_rejected', actor_user_id: null, origin: 'review_queue', source_ticket_id: null, review_item_id: 5, content_hash: null, created_at: '2026-10-20T10:00:00Z' },
    ])
    const q = calls[0]
    expect(q.sql).toContain('from "kb_article_events"')
    expect(q.sql).toContain('"kb_review_items"')
    expect(q.sql).toMatch(/order by "kb_article_events"\."created_at" desc, "kb_article_events"\."id" desc/)
  })

  it('scopes both the events and the review-item lookup to the workspace', async () => {
    respond = () => []
    const { getArticleEvents } = await import('@/lib/db/queries/kb-events')
    await getArticleEvents(7, 3)
    // org id appears for the events and again for the review-item subquery
    expect(calls[0].params.filter((p) => p === 3)).toHaveLength(2)
    expect(calls[0].params.filter((p) => p === 7)).toHaveLength(2)
  })
})
