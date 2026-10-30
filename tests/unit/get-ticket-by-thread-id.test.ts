import { describe, it, expect, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { getTableColumns } from 'drizzle-orm'
import { tickets } from '@/lib/db/schema'

// Real bug found live, in production, using the webhook path (which was
// believed to work correctly for thread replies — see Roadmap item 75,
// which only flagged the *polling* path as broken). A reply to a
// brand-new top-level Slack/Discord message never appended to the
// original ticket, even via the webhook.
//
// Root cause: a reply's threadId is always the ORIGINAL message's own id
// (Slack's thread_ts, Discord's thread channel id) — but the original
// ticket's own `source_thread_id` column was never populated with that
// value, because the root message itself had no thread_ts at the time it
// was first ingested (a brand-new top-level message is never already
// "in" a thread). Only `source_message_id` holds the value a later
// reply's threadId will match against. getTicketByThreadId matched only
// source_thread_id, so the single most common case — a first reply to a
// fresh top-level message — was silently never found.
//
// Verified against drizzle's pg-proxy driver (compiled SQL, no real
// connection) that the query now ORs across both columns, not just one.

describe('getTicketByThreadId matches either source_thread_id or source_message_id', () => {
  it('compiles a WHERE clause covering both columns, not just source_thread_id', async () => {
    const calls: { sql: string; params: unknown[] }[] = []
    const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
      calls.push({ sql: sqlText, params })
      return { rows: [] }
    })
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    vi.resetModules()

    const { getTicketByThreadId } = await import('@/lib/db/queries/tickets')
    await getTicketByThreadId('T123', 3)

    expect(calls.length).toBe(1)
    const sql = calls[0].sql.toLowerCase()
    expect(sql).toContain('source_thread_id')
    expect(sql).toContain('source_message_id')
    // Bare 'or' would false-positive on "org_id" — must be a real boolean
    // OR joining the two column conditions, not just a substring match.
    expect(sql).toMatch(/"source_thread_id"\s*=\s*\$\d+\s+or\s+"tickets"\."source_message_id"\s*=\s*\$\d+/)
    expect(calls[0].params).toContain('T123')
  })

  it('finds the ticket by source_message_id when source_thread_id does not match (the first-reply case)', async () => {
    const fakeDb = drizzle(async (sqlText: string) => {
      // Simulate a real Postgres OR match: the row's source_message_id
      // equals the searched threadId even though source_thread_id is null.
      if (sqlText.trim().toLowerCase().startsWith('select')) {
        return {
          rows: [Object.keys(getTableColumns(tickets)).map((key) => {
            if (key === 'id' || key === 'orgId') return 1
            if (key === 'sourceMessageId') return 'T123'
            if (key === 'sourcePlatform') return 'slack'
            if (key === 'createdAt' || key === 'updatedAt') return '2026-01-01'
            if (key === 'lastActivityAt') return '2026-01-01T00:00:00.000Z'
            return null
          })],
        }
      }
      return { rows: [] }
    })
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    vi.resetModules()

    const { getTicketByThreadId } = await import('@/lib/db/queries/tickets')
    const result = await getTicketByThreadId('T123', 3)

    expect(result).not.toBeNull()
    expect(result?.id).toBe(1)
  })

  it('returns null when neither column matches', async () => {
    const fakeDb = drizzle(async () => ({ rows: [] }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    vi.resetModules()

    const { getTicketByThreadId } = await import('@/lib/db/queries/tickets')
    const result = await getTicketByThreadId('no-match', 3)

    expect(result).toBeNull()
  })
})
