import { randomUUID } from 'node:crypto'
import { getTableColumns } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { csatMessages, ticketReplies, tickets } from '@/lib/db/schema'

/**
 * Recognising a message answerLoops posted itself, against a real PostgreSQL.
 * Circle sends every new comment back through its "Posted a comment"
 * Workflow, including the ones answerLoops wrote, and the webhook asks this
 * lookup whether an incoming comment id is one of ours.
 */

const h = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb: h.getDb }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const url = process.env.TEST_ACTIVITY_DATABASE_URL
const schema = `posted_${randomUUID().replaceAll('-', '')}`

describe.skipIf(!url)('isPostedByAnswerLoops on PostgreSQL', () => {
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
    await createTable(csatMessages, 'csat_messages')
  })

  afterAll(async () => {
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await client?.end()
    await admin?.end()
  })

  beforeEach(async () => {
    await client`TRUNCATE tickets, ticket_replies, csat_messages RESTART IDENTITY`
  })

  async function ticket(platform: string, orgId = 1) {
    const at = '2026-11-24T10:00:00Z'
    const [row] = await client`INSERT INTO tickets (org_id, org_ticket_number, source_platform, source_thread_id, source_message_id, content, status, created_at, updated_at, last_activity_at)
      VALUES (${orgId}, 1, ${platform}, '55', 'circle-post-55', 'question', 'open', ${at}, ${at}, ${at}) RETURNING id`
    return row.id as number
  }

  const reply = (ticketId: number, role: string, column: 'source_message_id' | 'discord_msg_id', id: string) =>
    client.unsafe(
      `INSERT INTO ticket_replies (ticket_id, ${column}, content, staff_name, author_role, created_at) VALUES ($1, $2, 'text', 'someone', $3, '2026-11-24T10:00:00Z')`,
      [ticketId, id, role]
    )

  const check = async (messageId: string, orgId = 1, platform = 'circle') =>
    (await import('@/lib/db/queries/tickets')).isPostedByAnswerLoops(messageId, orgId, platform as never)

  it('recognises an answer answerLoops posted', async () => {
    await reply(await ticket('circle'), 'ai', 'source_message_id', 'circle-comment-777')
    expect(await check('circle-comment-777')).toBe(true)
  })

  it('recognises a reply a team member sent from the dashboard', async () => {
    await reply(await ticket('circle'), 'staff', 'discord_msg_id', 'circle-comment-778')
    expect(await check('circle-comment-778')).toBe(true)
  })

  it('recognises the rating prompt posted after an answer', async () => {
    const id = await ticket('circle')
    await client`INSERT INTO csat_messages (message_id, ticket_id, created_at) VALUES ('circle-comment-779', ${id}, '2026-11-24T10:00:00Z')`
    expect(await check('circle-comment-779')).toBe(true)
  })

  it('does not treat a stored customer comment as answerLoops’s own', async () => {
    await reply(await ticket('circle'), 'customer', 'source_message_id', 'circle-comment-780')
    expect(await check('circle-comment-780')).toBe(false)
  })

  it('stays within the workspace and the channel', async () => {
    await reply(await ticket('circle', 2), 'ai', 'source_message_id', 'circle-comment-781')
    await reply(await ticket('discourse'), 'ai', 'source_message_id', 'circle-comment-782')
    expect(await check('circle-comment-781')).toBe(false)
    expect(await check('circle-comment-782')).toBe(false)
  })

  it('returns false for an id nothing posted', async () => {
    expect(await check('circle-comment-999')).toBe(false)
  })
})
