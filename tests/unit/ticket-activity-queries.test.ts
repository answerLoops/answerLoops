// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableColumns } from 'drizzle-orm'
import { tickets } from '@/lib/db/schema'

// Locks the SQL shape of the activity queries. Compiled with drizzle's
// pg-proxy driver, so the statements are the real ones with no database.

type Call = { sql: string; params: unknown[] }

async function withDb(rows: (c: Call) => unknown[][] = () => []) {
  const calls: Call[] = []
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    const call = { sql: sqlText, params }
    calls.push(call)
    return { rows: rows(call) }
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
  vi.resetModules()
  return {
    calls,
    tq: await import('@/lib/db/queries/tickets'),
    nq: await import('@/lib/db/queries/notifications'),
  }
}

const ticketRow = () => [
  Object.keys(getTableColumns(tickets)).map((key) => {
    if (key === 'id') return 1
    if (key === 'orgId') return 3
    if (key === 'status') return 'open'
    if (key === 'lastActivityAt') return '2026-10-01T00:00:00.000Z'
    return null
  }),
]

const lower = (s: string) => s.toLowerCase()
const UNSEEN = /"last_customer_reply_at" is not null and \("tickets"\."last_seen_at" is null or "tickets"\."last_customer_reply_at" > "tickets"\."last_seen_at"\)/

describe('markTicketSeen', () => {
  it('updates the ticket scoped by id and org, then clears its unread notifications', async () => {
    const { calls, tq } = await withDb((c) => (lower(c.sql).startsWith('update "tickets"') ? [[7]] : []))
    expect(await tq.markTicketSeen(7, 3)).toBe(true)
    expect(calls).toHaveLength(2)

    const t = lower(calls[0].sql)
    expect(t).toMatch(/^update "tickets" set "last_seen_at" = \$1 where \("tickets"\."id" = \$2 and "tickets"\."org_id" = \$3\) returning "id"/)
    expect(calls[0].params.slice(1)).toEqual([7, 3])

    const n = lower(calls[1].sql)
    expect(n).toMatch(/^update "notifications" set "read" = \$1 where/)
    expect(n).toContain('"notifications"."ticket_id" = $2')
    expect(n).toContain('"notifications"."org_id" = $3')
    expect(n).toContain('"notifications"."read" = $4')
    expect(calls[1].params).toEqual([1, 7, 3, 0])
  })

  it('returns false and touches no notifications when the ticket is not in that org', async () => {
    const { calls, tq } = await withDb()
    expect(await tq.markTicketSeen(7, 99)).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls.some((c) => lower(c.sql).includes('"notifications"'))).toBe(false)
  })
})

describe('unseen activity queries', () => {
  it('getUnseenActivityTickets filters by org and unseen condition, newest customer reply first', async () => {
    const { calls, tq } = await withDb(() => ticketRow())
    const out = await tq.getUnseenActivityTickets(3, 5)
    expect(out).toHaveLength(1)
    const q = lower(calls[0].sql)
    expect(q).toContain('"tickets"."org_id" = $1')
    expect(q).toMatch(UNSEEN)
    expect(q).toMatch(/order by "tickets"\."last_customer_reply_at" desc, "tickets"\."id" desc limit \$2/)
    expect(calls[0].params).toEqual([3, 5])
  })

  it('getUnseenActivityTickets defaults to a limit of 8', async () => {
    const { calls, tq } = await withDb()
    await tq.getUnseenActivityTickets(3)
    expect(calls[0].params).toEqual([3, 8])
  })

  it('countUnseenActivityTickets counts with the same condition in one org', async () => {
    const { calls, tq } = await withDb(() => [[4]])
    expect(await tq.countUnseenActivityTickets(3)).toBe(4)
    const q = lower(calls[0].sql)
    expect(q).toContain('count(*)')
    expect(q).toContain('"tickets"."org_id" = $1')
    expect(q).toMatch(UNSEEN)
  })
})

describe('getTickets activity options', () => {
  it('default ordering is by created_at and ignores last_activity_at', async () => {
    const { calls, tq } = await withDb()
    await tq.getTickets({}, 3)
    const q = lower(calls[0].sql)
    expect(q).toMatch(/order by "tickets"\."created_at" desc, "tickets"\."id" desc/)
    expect(q.slice(q.indexOf(' where '))).not.toContain('last_customer_reply_at')
    expect(q.slice(q.indexOf(' where '))).not.toContain('last_activity_at')
  })

  it('newActivity adds the unseen condition', async () => {
    const { calls, tq } = await withDb()
    await tq.getTickets({ newActivity: true }, 3)
    expect(lower(calls[0].sql)).toMatch(UNSEEN)
  })

  it('sort activity orders by last_activity_at desc then id desc', async () => {
    const { calls, tq } = await withDb()
    await tq.getTickets({ sort: 'activity' }, 3)
    expect(lower(calls[0].sql)).toMatch(/order by "tickets"\."last_activity_at" desc, "tickets"\."id" desc/)
  })

  it('sort activity applies the cursor on last_activity_at, not created_at', async () => {
    const { calls, tq } = await withDb()
    const at = '2026-10-02T03:04:05.678Z'
    await tq.getTickets({ sort: 'activity' }, 3, 20, { createdAt: at, id: 9 })
    const q = lower(calls[0].sql)
    expect(q).toMatch(/\("tickets"\."last_activity_at" < \$\d+ or \("tickets"\."last_activity_at" = \$\d+ and "tickets"\."id" < \$\d+\)\)/)
    expect(q).not.toMatch(/"tickets"\."created_at" </)
    expect(calls[0].params.filter((p) => typeof p === 'string' && p.startsWith('2026-10-02'))).toHaveLength(2)
    expect(calls[0].params).toContain(9)
  })

  it('the created sort keeps the cursor on created_at', async () => {
    const { calls, tq } = await withDb()
    await tq.getTickets({}, 3, 20, { createdAt: '2026-10-02T00:00:00.000Z', id: 9 })
    const q = lower(calls[0].sql)
    expect(q).toMatch(/"tickets"\."created_at" < \$\d+/)
    expect(q).not.toMatch(/"tickets"\."last_activity_at" </)
  })
})

describe('recordCustomerReply activity columns', () => {
  async function run(status: string) {
    const { calls, tq } = await withDb((c) => {
      const q = lower(c.sql)
      if (q.startsWith('select')) return [ticketRow()[0].map((v, i) => (Object.keys(getTableColumns(tickets))[i] === 'status' ? status : v))]
      if (q.startsWith('insert into "ticket_replies"')) return [[11]]
      return []
    })
    await tq.recordCustomerReply(1, 'hi', { authorName: 'alice', messageId: 'm-1' })
    return calls.filter((c) => lower(c.sql).startsWith('update "tickets"'))
  }

  it.each(['open', 'resolved'])('sets both activity columns in a single UPDATE (%s ticket)', async (status) => {
    const updates = await run(status)
    expect(updates).toHaveLength(1)
    const q = lower(updates[0].sql)
    expect(q).toContain('"last_activity_at" = $')
    expect(q).toContain('"last_customer_reply_at" = $')
    expect(q).not.toContain('last_seen_at')
  })
})

describe('notifications queries', () => {
  it('hands the bell ISO timestamps even though Postgres stores "2026-10-29 21:02:03+00"', async () => {
    // select order: id, org_id, ticket_id, type, message, read, created_at, then the joined ticket number
    const { nq } = await withDb(() => [[9, 3, 4, 'ticket_activity', 'alice replied on #7', 0, '2026-10-29 21:02:03+00', 7]])
    const [row] = await nq.getRecentNotifications(3)
    expect(row.created_at).toBe('2026-10-29T21:02:03.000Z')
    expect(row.ticket_number).toBe(7)
  })

  it('getRecentNotifications left-joins tickets on id and org, scopes to the org, newest first, with a limit', async () => {
    const { calls, nq } = await withDb()
    await nq.getRecentNotifications(3, 15)
    const q = lower(calls[0].sql)
    expect(q).toMatch(/left join "tickets" on \("tickets"\."id" = "notifications"\."ticket_id" and "tickets"\."org_id" = "notifications"\."org_id"\)/)
    expect(q).toMatch(/where "notifications"\."org_id" = \$1/)
    expect(q).toMatch(/order by "notifications"\."id" desc limit \$2/)
    expect(calls[0].params).toEqual([3, 15])
  })

  it('getRecentNotifications defaults to 20', async () => {
    const { calls, nq } = await withDb()
    await nq.getRecentNotifications(3)
    expect(calls[0].params).toEqual([3, 20])
  })

  it('markAllNotificationsRead updates only unread rows in the org and returns the count', async () => {
    const { calls, nq } = await withDb(() => [[1], [2], [3]])
    expect(await nq.markAllNotificationsRead(3)).toBe(3)
    const q = lower(calls[0].sql)
    expect(q).toMatch(/^update "notifications" set "read" = \$1 where \("notifications"\."org_id" = \$2 and "notifications"\."read" = \$3\)/)
    expect(calls[0].params).toEqual([1, 3, 0])
  })
})
