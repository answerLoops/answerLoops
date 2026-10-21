import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableColumns } from 'drizzle-orm'
import { kbArticles } from '@/lib/db/schema'

/**
 * Who added an article (kb_articles.created_by), driven through drizzle's
 * pg-proxy driver so the compiled INSERT and UPDATE statements are real. A new
 * article records its creator; refreshing an existing ticket article keeps the
 * original one; imports and syncs never set it.
 */

type Call = { sql: string; params: unknown[] }

let calls: Call[]
let respond: (c: Call) => unknown[][]

/** A full kb_articles row as the driver returns it: positional, vectors as text. */
const articleRow = (id: number) =>
  Object.values(getTableColumns(kbArticles)).map((col) =>
    col.name === 'id' ? id : col.columnType === 'PgVector' ? '[0.1,0.2]' : col.dataType === 'number' ? 1 : 'x'
  )

function install() {
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    const call = { sql: sqlText.replace(/\s+/g, ' ').trim().toLowerCase(), params }
    calls.push(call)
    return { rows: respond(call) }
  })
  const db = Object.assign(Object.create(fakeDb), {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
  vi.resetModules()
}

/** Maps each column of the compiled INSERT to the value it receives ('default' when omitted). */
function inserted(c: Call): Record<string, unknown> {
  const m = c.sql.match(/^insert into "kb_articles" \((.*?)\) values \((.*)\)(?: returning.*)?$/)
  if (!m) throw new Error(`not an insert into kb_articles: ${c.sql}`)
  const cols = m[1].split(', ').map((s) => s.replace(/"/g, ''))
  const vals = m[2].split(', ')
  return Object.fromEntries(
    cols.map((col, i) => {
      const token = vals[i]
      const p = token.match(/^\$(\d+)$/)
      return [col, p ? c.params[Number(p[1]) - 1] : token]
    })
  )
}

/** The assigned columns of an UPDATE (RETURNING lists every column, so it must not be searched). */
const setClause = (c: Call) => c.sql.slice(c.sql.indexOf(' set '), c.sql.indexOf(' where '))

const isInsert = (c: Call) => c.sql.startsWith('insert into "kb_articles"')
const isUpdate = (c: Call) => c.sql.startsWith('update "kb_articles"')

const article = { question: 'q', answer: 'a', embedding: [0.1, 0.2], model: 'm' }

beforeEach(() => {
  calls = []
  respond = () => [articleRow(42)]
  install()
})

describe('createArticle created_by', () => {
  it('stores the creating user on a new article', async () => {
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, createdBy: 12 }, 3)
    const row = inserted(calls.find(isInsert)!)
    expect(row.created_by).toBe(12)
    expect(row.org_id).toBe(3)
  })

  it('stores the creating user on a new ticket article', async () => {
    respond = (c) => (c.sql.startsWith('select') ? [] : [articleRow(42)])
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, sourceTicketId: 9, createdBy: 12 }, 3)
    expect(inserted(calls.find(isInsert)!).created_by).toBe(12)
  })

  it('stores null when no user is given', async () => {
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle(article, 3)
    expect(inserted(calls.find(isInsert)!).created_by).toBeNull()
  })

  it('stores the creating user when creating under an article cap', async () => {
    respond = (c) => (c.sql.includes('count(*)') ? [[0]] : [articleRow(42)])
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, createdBy: 12 }, 3, 2000)
    expect(inserted(calls.find(isInsert)!).created_by).toBe(12)
  })

  it('keeps the original creator when an existing ticket article is refreshed', async () => {
    // The ticket already has an article, so createArticle updates it in place.
    respond = () => [articleRow(7)]
    const { createArticle } = await import('@/lib/db/queries/kb')
    await createArticle({ ...article, sourceTicketId: 9, createdBy: 99 }, 3)
    expect(calls.some(isInsert)).toBe(false)
    const update = calls.find(isUpdate)!
    expect(setClause(update)).not.toContain('created_by')
    expect(update.params).not.toContain(99)
  })
})

describe('articles made by imports and syncs', () => {
  const fromSource = { ...article, sourceId: 5, sourcePage: 1 }

  it('createArticleFromSource leaves created_by unset', async () => {
    const { createArticleFromSource } = await import('@/lib/db/queries/kb')
    await createArticleFromSource(fromSource, 3)
    const row = inserted(calls.find(isInsert)!)
    expect([null, 'default']).toContain(row.created_by ?? 'default')
  })

  it('upsertArticleFromSource leaves created_by unset when it creates and when it refreshes', async () => {
    respond = (c) => (c.sql.startsWith('select') ? [] : [articleRow(42)])
    const { upsertArticleFromSource } = await import('@/lib/db/queries/kb')
    await upsertArticleFromSource(fromSource, 3)
    expect([null, 'default']).toContain(inserted(calls.find(isInsert)!).created_by ?? 'default')

    calls = []
    respond = () => [articleRow(7)]
    install()
    const again = await import('@/lib/db/queries/kb')
    await again.upsertArticleFromSource(fromSource, 3)
    expect(setClause(calls.find(isUpdate)!)).not.toContain('created_by')
  })
})
