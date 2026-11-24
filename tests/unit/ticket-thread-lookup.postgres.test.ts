import { randomUUID } from 'node:crypto'
import { getTableColumns } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ticketReplies, tickets } from '@/lib/db/schema'

/**
 * Finding the ticket a message's thread belongs to, against a real
 * PostgreSQL: a thread id only ever matches tickets from the same channel and
 * workspace, so two channels that number their threads the same way (a
 * Circle post and a Discourse topic, say) never land on each other's tickets.
 */

const h = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb: h.getDb }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const url = process.env.TEST_ACTIVITY_DATABASE_URL
const schema = `threads_${randomUUID().replaceAll('-', '')}`

describe.skipIf(!url)('getTicketByThreadId on PostgreSQL', () => {
  let admin: postgres.Sql
  let client: postgres.Sql

  const createTable = async (table: PgTable, name: string) => {
    const columns = Object.values(getTableColumns(table)).map((c) =>
      c.name === 'id' ? 'id serial primary key' : `"${c.name}" ${c.getSQLType()}`
    )
    await client.unsafe(`CREATE TABLE ${name} (${columns.join(', ')})`)
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`CREATE SCHEMA ${admin(schema)}`
    client = postgres(url!, {
      prepare: false,
      onnotice: () => {},
      connection: { search_path: `${schema},public,pg_catalog`, statement_timeout: 8_000 },
    })
    h.getDb.mockReturnValue(drizzle(client))
    await createTable(tickets, 'tickets')
    await createTable(ticketReplies, 'ticket_replies')
  })

  afterAll(async () => {
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await client?.end()
    await admin?.end()
  })

  beforeEach(async () => {
    await client`TRUNCATE tickets, ticket_replies RESTART IDENTITY`
  })

  async function ticket(platform: string, thread: string, messageId: string, orgId = 1, createdAt = '2026-11-24T10:00:00Z') {
    const [row] = await client`INSERT INTO tickets (org_id, org_ticket_number, source_platform, source_thread_id, source_message_id, content, status, created_at, updated_at, last_activity_at)
      VALUES (${orgId}, 1, ${platform}, ${thread}, ${messageId}, 'question', 'open', ${createdAt}, ${createdAt}, ${createdAt}) RETURNING id`
    return row.id as number
  }

  const find = async (threadId: string, orgId: number, platform: string) =>
    (await import('@/lib/db/queries/tickets')).getTicketByThreadId(threadId, orgId, platform as never)

  it('matches a thread only within its own channel', async () => {
    const discourse = await ticket('discourse', '55', 'discourse-post-901')
    expect((await find('55', 1, 'circle'))).toBeNull()
    expect((await find('55', 1, 'discourse'))?.id).toBe(discourse)
  })

  it('picks the same channel\'s ticket when another channel shares the thread id', async () => {
    await ticket('discourse', '55', 'discourse-post-901', 1, '2026-11-24T11:00:00Z')
    const circle = await ticket('circle', '55', 'circle-post-55', 1, '2026-11-24T10:00:00Z')
    expect((await find('55', 1, 'circle'))?.id).toBe(circle)
  })

  it('finds a ticket through a message already appended to it, still within the channel', async () => {
    const circle = await ticket('circle', '55', 'circle-post-55')
    await client`INSERT INTO ticket_replies (ticket_id, source_message_id, content, staff_name, author_role) VALUES (${circle}, 'circle-comment-7', 'thanks', 'member', 'customer')`
    expect((await find('circle-comment-7', 1, 'circle'))?.id).toBe(circle)
    expect(await find('circle-comment-7', 1, 'discourse')).toBeNull()
  })

  it('stays within the workspace', async () => {
    await ticket('circle', '55', 'circle-post-55', 2)
    expect(await find('55', 1, 'circle')).toBeNull()
  })
})
