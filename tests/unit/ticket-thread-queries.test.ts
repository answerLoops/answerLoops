// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableColumns } from 'drizzle-orm'
import { tickets } from '@/lib/db/schema'

// The SQL behind the thread: a reply to a stored reply finds its ticket, a
// redelivered message is a no-op, maintainer context changes nothing else, and
// the thread loads oldest first. Compiled with drizzle's pg-proxy driver, so
// the statements are the real ones with no database behind them.

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
  return { calls, queries: await import('@/lib/db/queries/tickets') }
}

// One row in the table's own column order, so the status lands where the query reads it.
const ticketRow = (status: string) => [
  Object.keys(getTableColumns(tickets)).map((key) => {
    if (key === 'status') return status
    if (key === 'id') return 1
    if (key === 'orgId') return 3
    return null
  }),
]

describe('getTicketByThreadId reaches a ticket through a message stored in its thread', () => {
  it('ORs the ticket columns with a subquery over stored thread messages, in one org-scoped query', async () => {
    const { calls, queries } = await withDb()
    await queries.getTicketByThreadId('telegram:-100:2', 3)

    expect(calls).toHaveLength(1)
    const sql = calls[0].sql.toLowerCase()
    expect(sql).toMatch(/"id" in \(select "ticket_id" from "ticket_replies" where "ticket_replies"\."source_message_id" = \$\d+\)/)
    expect(sql).toMatch(/"org_id" = \$\d+/)
    expect(calls[0].params.filter((p) => p === 'telegram:-100:2')).toHaveLength(3)
    expect(calls[0].params).toContain(3)
  })
})

describe('recordCustomerReply', () => {
  it('stores the author, the customer role and the channel message id, ignoring a redelivery', async () => {
    const { calls, queries } = await withDb((c) => {
      if (c.sql.toLowerCase().startsWith('select')) return ticketRow('open')
      return []
    })
    // The ticket lookup returns a row, the insert returns nothing: the message was already stored.
    const stored = await queries.recordCustomerReply(1, 'hello', { authorName: 'alice', messageId: 'm-9' })
    const insert = calls.find((c) => c.sql.toLowerCase().startsWith('insert into "ticket_replies"'))
    expect(insert).toBeDefined()
    expect(insert!.sql.toLowerCase()).toContain('on conflict do nothing')
    expect(insert!.params).toEqual(expect.arrayContaining(['alice', 'hello', 'customer', 'm-9']))
    expect(stored).toBe(false)
    expect(calls.some((c) => c.sql.toLowerCase().startsWith('insert into "ticket_events"'))).toBe(false)
    expect(calls.some((c) => c.sql.toLowerCase().startsWith('update "tickets"'))).toBe(false)
  })
})

describe('recordCustomerReply when the message is new', () => {
  it('reopens a resolved ticket and logs one customer_reply event', async () => {
    const { calls, queries } = await withDb((c) => {
      const q = c.sql.toLowerCase()
      if (q.startsWith('select')) return ticketRow('resolved')
      if (q.startsWith('insert into "ticket_replies"')) return [[11]]
      return []
    })
    expect(await queries.recordCustomerReply(1, 'still broken', { authorName: 'alice', messageId: 'm-2' })).toBe(true)

    const update = calls.find((c) => c.sql.toLowerCase().startsWith('update "tickets"'))
    expect(update?.params).toContain('open')
    const event = calls.find((c) => c.sql.toLowerCase().startsWith('insert into "ticket_events"'))
    expect(event?.params).toEqual(expect.arrayContaining(['customer_reply', 'resolved', 'open', 'customer']))
  })

  it('leaves an open ticket open', async () => {
    const { calls, queries } = await withDb((c) => {
      const q = c.sql.toLowerCase()
      if (q.startsWith('select')) return ticketRow('open')
      if (q.startsWith('insert into "ticket_replies"')) return [[12]]
      return []
    })
    await queries.recordCustomerReply(1, 'one more thing')
    const update = calls.find((c) => c.sql.toLowerCase().startsWith('update "tickets"'))
    expect(update?.params).not.toContain('open')
  })
})

describe('recordThreadContext', () => {
  it('stores the message as context and touches nothing else on the ticket', async () => {
    const { calls, queries } = await withDb((c) => (c.sql.toLowerCase().startsWith('insert') ? [[11]] : []))
    const stored = await queries.recordThreadContext(1, 'Looking into it', { authorName: 'maint', messageId: 'm-1' })

    expect(stored).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].sql.toLowerCase()).toContain('insert into "ticket_replies"')
    expect(calls[0].sql.toLowerCase()).toContain('on conflict do nothing')
    expect(calls[0].params).toEqual(expect.arrayContaining(['maint', 'Looking into it', 'context', 'm-1']))
  })

  it('reports false when the message was already stored', async () => {
    const { queries } = await withDb()
    expect(await queries.recordThreadContext(1, 'again', { authorName: 'maint', messageId: 'm-1' })).toBe(false)
  })
})

describe('recordAnswerLoopsReply', () => {
  it('stores what answerLoops posted under the ai role and the channel message id, and touches nothing else on the ticket', async () => {
    const { calls, queries } = await withDb((c) => (c.sql.toLowerCase().startsWith('insert') ? [[12]] : []))
    const stored = await queries.recordAnswerLoopsReply(1, 'Use the reset link.', { messageId: 'posted-1' })

    expect(stored).toBe(true)
    // One insert: no status change, no event, no notification, no ticket lookup.
    expect(calls).toHaveLength(1)
    const sql = calls[0].sql.toLowerCase()
    expect(sql).toContain('insert into "ticket_replies"')
    expect(sql).toContain('on conflict do nothing')
    expect(calls[0].params).toEqual(expect.arrayContaining(['answerLoops', 'Use the reset link.', 'ai', 'posted-1']))
  })

  it('reports false when the same posted message is already stored', async () => {
    const { queries } = await withDb()
    expect(await queries.recordAnswerLoopsReply(1, 'again', { messageId: 'posted-1' })).toBe(false)
  })

  it('stores a reply with no channel id (the id column stays empty)', async () => {
    const { calls, queries } = await withDb((c) => (c.sql.toLowerCase().startsWith('insert') ? [[13]] : []))
    await queries.recordAnswerLoopsReply(1, 'text')
    expect(calls[0].params).toContain(null)
  })

  it('is found by getTicketByThreadId, so a reply to the bot\'s message reaches the ticket', async () => {
    const { calls, queries } = await withDb()
    await queries.getTicketByThreadId('posted-1', 3)
    expect(calls[0].sql.toLowerCase()).toContain('from "ticket_replies" where "ticket_replies"."source_message_id"')
  })
})

describe('getTicketReplies', () => {
  it('loads the thread oldest first, breaking ties by id', async () => {
    const { calls, queries } = await withDb()
    await queries.getTicketReplies(5)
    expect(calls[0].sql.toLowerCase()).toMatch(/order by "ticket_replies"\."created_at", "ticket_replies"\."id"/)
  })
})
