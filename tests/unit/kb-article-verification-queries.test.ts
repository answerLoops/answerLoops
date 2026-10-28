import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableColumns } from 'drizzle-orm'
import { kbArticles } from '@/lib/db/schema'
import { contentHash } from '@/lib/kb/revision'

/**
 * Article verification (lib/db/queries/kb.ts verifyArticle and listArticles),
 * driven through drizzle's pg-proxy driver so the compiled statements are real.
 * Pins what a verification records, that it is locked to the text the verifier
 * saw, that it is scoped to the workspace, and that nothing that rewrites an
 * article (a ticket refresh, an import, a sync) ever touches the verification.
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

const cols = Object.values(getTableColumns(kbArticles))
const colIndex = (name: string) => cols.findIndex((c) => c.name === name)

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

const verbs = () => calls.map((c) => c.sql.split(' ').slice(0, 3).join(' '))
const eventInserts = () => calls.filter((c) => c.sql.startsWith('insert into "kb_article_events"'))
/** Maps each column an UPDATE assigns to the value it receives. */
function assignments(c: Call): Record<string, unknown> {
  const set = c.sql.slice(c.sql.indexOf(' set ') + 5, c.sql.indexOf(' where '))
  return Object.fromEntries(
    set.split(', ').map((part) => {
      const m = part.match(/^"(\w+)" = \$(\d+)$/)
      return m ? [m[1], c.params[Number(m[2]) - 1]] : [part, undefined]
    })
  )
}
const updateSet = (c: Call) => c.sql.slice(c.sql.indexOf(' set '), c.sql.indexOf(' where '))

/** Maps each column of a compiled INSERT on `table` to its value ('default' when omitted). */
function insertedInto(table: string, c: Call): Record<string, unknown> {
  const m = c.sql.match(new RegExp(`^insert into "${table}" \\((.*?)\\) values \\((.*?)\\)(?: returning.*)?$`))
  if (!m) throw new Error(`not an insert into ${table}: ${c.sql}`)
  const names = m[1].split(', ').map((s) => s.replace(/"/g, ''))
  const vals = m[2].split(', ')
  return Object.fromEntries(
    names.map((n, i) => {
      const p = vals[i].match(/^\$(\d+)$/)
      return [n, p ? c.params[Number(p[1]) - 1] : vals[i]]
    })
  )
}

beforeEach(() => {
  calls = []
  respond = () => []
  install()
})

describe('verifyArticle', () => {
  const found = (q = 'How do I reset?', a = 'Use the link.') =>
    (c: Call) => (c.sql.startsWith('select') ? [[q, a]] : [])

  it('records who, when, the note and the hash of the text being verified, in one transaction', async () => {
    respond = found('How do I reset?', 'Use the link.')
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    const out = await verifyArticle({ articleId: 7, userId: 12, note: 'Checked against v2.4' }, 3)

    const hash = contentHash('How do I reset?', 'Use the link.')
    expect(out).toEqual({ verifiedAt: expect.any(String), contentHash: hash })
    const update = calls.find((c) => c.sql.startsWith('update "kb_articles"'))!
    expect(update.params).toEqual(expect.arrayContaining([out!.verifiedAt, 12, hash, 'Checked against v2.4', 7, 3]))
    expect(verbs()).toEqual(['begin', expect.stringMatching(/^select/), expect.stringMatching(/^update/), 'insert into "kb_article_events"', 'commit'])
  })

  it('locks the row while it reads the text, so an edit cannot slip in before the hash is taken', async () => {
    respond = found()
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    await verifyArticle({ articleId: 7, userId: 12 }, 3)
    expect(calls.find((c) => c.sql.startsWith('select'))!.sql).toMatch(/ for update/)
  })

  it('appends a verified event by the verifier, with the same hash', async () => {
    respond = found()
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    await verifyArticle({ articleId: 7, userId: 12 }, 3)
    expect(eventInserts()).toHaveLength(1)
    expect(insertedInto('kb_article_events', eventInserts()[0])).toMatchObject({
      org_id: 3,
      article_id: 7,
      type: 'verified',
      actor_user_id: 12,
      origin: 'manual',
      content_hash: contentHash('How do I reset?', 'Use the link.'),
    })
  })

  it('scopes the read and the write to the workspace', async () => {
    respond = found()
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    await verifyArticle({ articleId: 7, userId: 12 }, 3)
    const select = calls.find((c) => c.sql.startsWith('select'))!
    const update = calls.find((c) => c.sql.startsWith('update "kb_articles"'))!
    expect(select.params).toEqual(expect.arrayContaining([7, 3]))
    expect(update.params.filter((p) => p === 3)).toHaveLength(1)
    expect(update.sql).toContain('"org_id"')
  })

  it("treats another workspace's article as not found and writes nothing", async () => {
    respond = () => []
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    expect(await verifyArticle({ articleId: 7, userId: 12 }, 3)).toBeNull()
    expect(calls.some((c) => c.sql.startsWith('update'))).toBe(false)
    expect(eventInserts()).toHaveLength(0)
  })

  it.each([
    ['  checked  ', 'checked'],
    ['', null],
    ['   ', null],
    [undefined, null],
    [null, null],
  ])('stores the note %j as %j', async (note, stored) => {
    respond = found()
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    await verifyArticle({ articleId: 7, userId: 12, note: note as string | null | undefined }, 3)
    expect(assignments(calls.find((c) => c.sql.startsWith('update "kb_articles"'))!).verification_note).toBe(stored)
  })

  it('caps an over-long note at 500 characters', async () => {
    respond = found()
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    await verifyArticle({ articleId: 7, userId: 12, note: 'x'.repeat(900) }, 3)
    const update = calls.find((c) => c.sql.startsWith('update "kb_articles"'))!
    expect(assignments(update).verification_note).toBe('x'.repeat(500))
  })

  it('writes no event when the update fails', async () => {
    respond = (c) => {
      if (c.sql.startsWith('update')) throw new Error('boom')
      return [['q', 'a']]
    }
    const { verifyArticle } = await import('@/lib/db/queries/kb')
    await expect(verifyArticle({ articleId: 7, userId: 12 }, 3)).rejects.toThrow()
    expect(eventInserts()).toHaveLength(0)
    expect(verbs()).not.toContain('commit')
  })
})

describe('listArticles verification', () => {
  const listRow = (over: Record<string, unknown>, ticketNumber: number | null, name: string | null, email: string | null) => [
    ...articleRow(over),
    ticketNumber,
    name,
    email,
  ]
  const hash = contentHash('q', 'a')

  it('reads each article as never, verified or changed against its current text', async () => {
    respond = () => [
      listRow({ id: 1, question: 'q', answer: 'a', verified_at: null }, null, null, null),
      listRow({ id: 2, question: 'q', answer: 'a', verified_at: '2026-10-01T00:00:00.000Z', verified_by: 12, verified_content_hash: hash, verification_note: 'v2.4' }, null, 'Dana', 'dana@example.com'),
      listRow({ id: 3, question: 'q', answer: 'a edited', verified_at: '2026-10-01T00:00:00.000Z', verified_by: 12, verified_content_hash: hash }, null, 'Dana', null),
    ]
    const { listArticles } = await import('@/lib/db/queries/kb')
    const out = await listArticles(false, 3)
    expect(out.map((a) => [a.id, a.verification?.status])).toEqual([
      [1, 'never'],
      [2, 'verified'],
      [3, 'changed'],
    ])
    expect(out[1].verification).toEqual({ status: 'verified', verified_at: '2026-10-01T00:00:00.000Z', verified_by: 12, verified_by_name: 'Dana', note: 'v2.4' })
  })

  it("names the verifier by name, falls back to their email, and shows no name for a deleted user", async () => {
    const base = { question: 'q', answer: 'a', verified_at: '2026-10-01T00:00:00.000Z', verified_content_hash: hash }
    respond = () => [
      listRow({ id: 1, ...base, verified_by: 12 }, null, 'Dana', 'dana@example.com'),
      listRow({ id: 2, ...base, verified_by: 13 }, null, null, 'sam@example.com'),
      listRow({ id: 3, ...base, verified_by: null }, null, null, null),
    ]
    const { listArticles } = await import('@/lib/db/queries/kb')
    const out = await listArticles(false, 3)
    expect(out.map((a) => a.verification?.verified_by_name)).toEqual(['Dana', 'sam@example.com', null])
  })

  it("joins the verifier's name from users and scopes the list to the workspace", async () => {
    respond = () => []
    const { listArticles } = await import('@/lib/db/queries/kb')
    await listArticles(true, 3)
    expect(calls[0].sql).toContain('left join "users"')
    expect(calls[0].sql).toContain('"kb_articles"."verified_by"')
    expect(calls[0].params).toContain(3)
  })
})

describe('nothing that rewrites an article touches its verification', () => {
  const article = { question: 'q', answer: 'a', embedding: [0.1, 0.2], model: 'm' }
  const verifiedCols = ['verified_at', 'verified_by', 'verified_content_hash', 'verification_note']
  const touchesVerification = (text: string) => verifiedCols.some((c) => text.includes(c))

  it('a ticket article refresh leaves the verification columns alone, so changed text reads as changed', async () => {
    respond = (c) => (c.sql.startsWith('select "id", "question"') ? [[7, 'old q', 'old a']] : [articleRow()])
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, sourceTicketId: 9, createdBy: 12 }, 3)
    const update = calls.find((c) => c.sql.startsWith('update "kb_articles"'))!
    expect(touchesVerification(updateSet(update))).toBe(false)
  })

  it('a sync that rewrites a page leaves the verification columns alone', async () => {
    respond = (c) => {
      const row = articleRow({ question: 'old q', answer: 'old a' })
      return c.sql.includes('"source_page"') && c.sql.startsWith('select') ? [row] : [articleRow()]
    }
    const { upsertArticleFromSource } = await import('@/lib/db/queries/kb')
    await upsertArticleFromSource({ ...article, sourceId: 5, sourcePage: 1 }, 3)
    const update = calls.find((c) => c.sql.startsWith('update "kb_articles"'))!
    expect(touchesVerification(updateSet(update))).toBe(false)
  })

  it('new articles from a sync or import are created unverified', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[0]] : c.sql.includes('regexp_replace') ? [] : [articleRow()])
    const { createArticleFromSource } = await import('@/lib/db/queries/kb')
    const { createArticleFromSourceWithinCap } = await import('@/lib/db/queries/kb-article-cap')
    await createArticleFromSource({ ...article, sourceId: 5, sourcePage: 1 }, 3)
    await createArticleFromSourceWithinCap({ ...article, sourceId: 5, sourcePage: 1 }, 3, 2000)
    const inserts = calls.filter((c) => c.sql.startsWith('insert into "kb_articles"'))
    expect(inserts).toHaveLength(2)
    for (const c of inserts) {
      const row = insertedInto('kb_articles', c)
      for (const col of verifiedCols) expect([undefined, null, 'default']).toContain(row[col])
    }
  })

  it('has no verification column in the article column list the refresh paths write', () => {
    // Guards the premise above: the columns exist, and are the ones the tests look for.
    for (const name of verifiedCols) expect(colIndex(name)).toBeGreaterThanOrEqual(0)
  })
})
