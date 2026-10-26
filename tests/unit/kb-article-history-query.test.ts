import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

/**
 * getArticleHistory, driven through drizzle's pg-proxy driver so the compiled
 * SQL is real: an article from another workspace reads as missing, every table
 * it touches is scoped to the workspace, and the actor and ticket number come
 * from the joins.
 */

type Call = { sql: string; params: unknown[] }
let calls: Call[]
let respond: (c: Call, n: number) => unknown[][]

beforeEach(() => {
  calls = []
  const db = drizzle(async (sqlText: string, params: unknown[]) => {
    const call = { sql: sqlText.replace(/\s+/g, ' ').trim().toLowerCase(), params }
    calls.push(call)
    return { rows: respond(call, calls.length) }
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
  vi.resetModules()
})

// id, org_id, article_id, type, actor_user_id, origin, source_ticket_id, review_item_id, content_hash, created_at,
// then the joined actor name, actor email and ticket number.
const row = (
  id: number,
  type: string,
  actor: number | null,
  origin: string,
  ticketId: number | null,
  created: string,
  join: [string | null, string | null, number | null]
) => [id, 3, 7, type, actor, origin, ticketId, null, 'h', created, ...join]

describe('getArticleHistory', () => {
  it('returns null, and reads no events, for an article that is not in the workspace', async () => {
    respond = () => []
    const { getArticleHistory } = await import('@/lib/db/queries/kb-events')
    expect(await getArticleHistory(7, 3)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('from "kb_articles"')
    expect(calls[0].params).toEqual(expect.arrayContaining([7, 3]))
  })

  it('returns an empty list for an article with no events', async () => {
    respond = (_c, n) => (n === 1 ? [[7]] : [])
    const { getArticleHistory } = await import('@/lib/db/queries/kb-events')
    expect(await getArticleHistory(7, 3)).toEqual([])
  })

  it('adds the actor name (or email) and the ticket number, newest first', async () => {
    respond = (_c, n) =>
      n === 1
        ? [[7]]
        : [
            row(9, 'verified', 12, 'manual', null, '2026-10-22T10:00:00Z', ['Dana', 'dana@example.com', null]),
            row(8, 'edited', 13, 'ticket_promotion', 41, '2026-10-21T10:00:00Z', [null, 'lee@example.com', 38]),
            row(7, 'created', null, 'sync', null, '2026-10-20T10:00:00Z', [null, null, null]),
          ]
    const { getArticleHistory } = await import('@/lib/db/queries/kb-events')
    const out = await getArticleHistory(7, 3)
    expect(out).toMatchObject([
      { id: 9, type: 'verified', actor_name: 'Dana', source_ticket_number: null },
      { id: 8, type: 'edited', actor_name: 'lee@example.com', source_ticket_id: 41, source_ticket_number: 38 },
      { id: 7, type: 'created', actor_user_id: null, actor_name: null, source_ticket_number: null },
    ])
    expect(calls[1].sql).toMatch(/order by "kb_article_events"\."created_at" desc, "kb_article_events"\."id" desc/)
  })

  it('does not show a name for an event that has no actor', async () => {
    respond = (_c, n) =>
      n === 1 ? [[7]] : [row(7, 'created', null, 'import', null, '2026-10-20T10:00:00Z', ['Someone', 's@example.com', null])]
    const { getArticleHistory } = await import('@/lib/db/queries/kb-events')
    const [only] = (await getArticleHistory(7, 3))!
    expect(only.actor_name).toBeNull()
  })

  it('scopes the article, the events, the review-item lookup and the ticket join to the workspace', async () => {
    respond = (_c, n) => (n === 1 ? [[7]] : [])
    const { getArticleHistory } = await import('@/lib/db/queries/kb-events')
    await getArticleHistory(7, 3)
    expect(calls[0].params.filter((p) => p === 3)).toHaveLength(1)
    expect(calls[1].sql).toContain('left join "users"')
    expect(calls[1].sql).toContain('left join "tickets"')
    // the events, the ticket join and the review-item subquery each carry the workspace
    expect(calls[1].params.filter((p) => p === 3)).toHaveLength(3)
  })
})
