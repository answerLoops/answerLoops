import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { getTableColumns } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { tickets } from '@/lib/db/schema'
import { countUnseenActivityTickets, deleteTicket, getActivityCutoff, getTickets, markAllTicketsSeen, markTicketSeen, recordCustomerReply } from '@/lib/db/queries/tickets'

const state = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => state)

const url = process.env.TEST_ACTIVITY_DATABASE_URL
const schema = `activity_${randomUUID().replaceAll('-', '')}`
const old = '2020-01-01T00:00:00.000Z'
const later = '2100-01-01T00:00:00.000Z'

describe.skipIf(!url)('bulk ticket activity on PostgreSQL', () => {
  let admin: postgres.Sql
  let client: postgres.Sql

  beforeAll(async () => {
    admin = postgres(url!, { max: 1 })
    await admin`CREATE SCHEMA ${admin(schema)}`
    client = postgres(url!, {
      prepare: false,
      connection: { search_path: `${schema},pg_catalog`, application_name: schema, lock_timeout: 5_000, statement_timeout: 8_000 },
    })
    state.getDb.mockReturnValue(drizzle(client))
    // Use the real ticket column types so the production reply query can read
    // the full row. Only the tables used by these queries are needed here.
    const columns = Object.values(getTableColumns(tickets)).map((column) => {
      if (column.name === 'id') return 'id serial primary key'
      if (column.name === 'last_activity_at') return 'last_activity_at timestamptz not null default now()'
      return `"${column.name}" ${column.getSQLType()}`
    })
    await client.unsafe(`CREATE TABLE tickets (${columns.join(', ')})`)
    await client`CREATE TABLE notifications (
      id serial primary key, org_id int not null, ticket_id int references tickets(id),
      type text, message text CHECK (message NOT LIKE '%Rejected reply%'),
      read int not null default 0, created_at text default now()::text, CHECK (org_id <> 9 OR read = 0)
    )`
    await client`CREATE TABLE ticket_replies (
      id serial primary key, ticket_id int references tickets(id), staff_name text,
      content text, author_role text, source_message_id text, discord_msg_id text, created_at text default now()::text
    )`
    await client`CREATE TABLE ticket_events (
      id serial primary key, ticket_id int references tickets(id), event_type text,
      old_value text, new_value text, actor text, created_at text default now()::text
    )`
    await client`CREATE TABLE kb_articles (source_ticket_id int references tickets(id))`
    await client`CREATE TABLE ticket_links (ticket_id int references tickets(id), related_id int references tickets(id))`
    for (const table of ['ticket_embeddings', 'ticket_feedback', 'answer_messages', 'csat_messages', 'csat_ratings', 'ai_assessments']) {
      await client`CREATE TABLE ${client(table)} (ticket_id int references tickets(id))`
    }
  })

  afterAll(async () => {
    await client?.end()
    if (admin) {
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
      await admin.end()
    }
  })

  beforeEach(async () => {
    await client`TRUNCATE tickets RESTART IDENTITY CASCADE`
  })

  async function seed(org = 1, size = 1, reply: string | null = old, seen: string | null = null) {
    const rows = await client<{ id: number }[]>`
      INSERT INTO tickets (org_id, org_ticket_number, last_customer_reply_at, last_seen_at, status, content)
      SELECT ${org}, 7, ${reply}::timestamptz, ${seen}::timestamptz, 'open', 'Question'
      FROM generate_series(1, ${size}) RETURNING id
    `
    await client`INSERT INTO notifications (org_id, ticket_id)
      SELECT ${org}, unnest(${rows.map(({ id }) => id)}::int[])
    `
    return rows[0].id
  }

  async function waitForLock(query: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await admin<{ blocked: boolean }[]>`
        SELECT EXISTS (
          SELECT FROM pg_stat_activity
          WHERE application_name = ${schema} AND wait_event_type = 'Lock' AND query LIKE ${query}
        ) AS blocked
      `
      if (row.blocked) return
      await delay(20)
    }
    throw new Error('The expected database writer did not wait for its lock')
  }

  it('returns zero for an empty backlog', async () => {
    expect(await markAllTicketsSeen(1, await getActivityCutoff())).toBe(0)
  })

  it('includes the cutoff itself and excludes a reply one microsecond later', async () => {
    const cutoff = '2020-10-02T00:00:00.123456Z'
    await seed(1, 1, cutoff)
    await seed(1, 1, '2020-10-02T00:00:00.123457Z')
    expect(await countUnseenActivityTickets(1, cutoff)).toBe(1)
    expect(await markAllTicketsSeen(1, cutoff)).toBe(1)
    expect(await client`SELECT read FROM notifications ORDER BY id`).toEqual([{ read: 1 }, { read: 0 }])
  })

  it.each([
    ['2020-01-01T00:00:00.001200Z', '2020-01-01T00:00:00.001300Z', 1],
    ['2020-01-01T00:00:00.000501Z', '2020-01-01T00:00:00.000502Z', 1],
    ['2020-01-01T00:00:00.000502Z', '2020-01-01T00:00:00.000501Z', 0],
  ])('uses the exact reply at %s against cutoff %s', async (reply, cutoff, count) => {
    const id = await seed(1, 1, old, '2020-01-01T00:00:00.000500Z')
    // Shadow the wall clock in this fixture's schema to make the microsecond
    // boundary deterministic while exercising the real reply writer.
    await client.unsafe(`CREATE FUNCTION clock_timestamp() RETURNS timestamptz
      LANGUAGE sql AS $$ SELECT '${reply}'::timestamptz $$`)
    try {
      expect(await recordCustomerReply(id, 'Exact reply')).toBe(true)
      const [row] = await client`
        SELECT last_customer_reply_at = ${reply}::timestamptz AS exact FROM tickets WHERE id = ${id}
      `
      expect(row.exact).toBe(true)
      const [ticket] = await getTickets({}, 1, 1, undefined, true)
      expect(ticket.has_new_activity).toBe(true)
      expect(await markAllTicketsSeen(1, cutoff)).toBe(count)
      expect(await countUnseenActivityTickets(1)).toBe(1 - count)
    } finally {
      await client`DROP FUNCTION clock_timestamp()`
    }
  })

  it.each([1, 2500])('clears exactly %i eligible tickets and their unread notifications', async (size) => {
    const matching = await seed(1, size)
    const seen = await seed(1, 1, old, old)
    const noReply = await seed(1, 1, null)
    const newer = await seed(1, 1, later)
    const otherOrg = await seed(2)
    await client`INSERT INTO notifications (org_id, ticket_id) VALUES (2, ${matching}), (1, NULL)`
    const cutoff = await getActivityCutoff()
    expect(await markAllTicketsSeen(1, cutoff)).toBe(size)
    expect(await markAllTicketsSeen(1, cutoff)).toBe(0)
    expect(await countUnseenActivityTickets(1)).toBe(1)
    expect(await countUnseenActivityTickets(2)).toBe(1)
    const unread = await client`SELECT org_id, ticket_id FROM notifications WHERE read = 0 ORDER BY id`
    expect(unread).toEqual([
      { org_id: 1, ticket_id: seen }, { org_id: 1, ticket_id: noReply },
      { org_id: 1, ticket_id: newer }, { org_id: 2, ticket_id: otherOrg },
      { org_id: 2, ticket_id: matching }, { org_id: 1, ticket_id: null },
    ])
    const [row] = await client`SELECT status, last_seen_at >= ${cutoff}::timestamptz AS seen_now FROM tickets WHERE id = ${matching}`
    expect(row).toEqual({ status: 'open', seen_now: true })
  })

  it('rolls back all tickets when a notification update fails', async () => {
    await seed(9, 3)
    await expect(markAllTicketsSeen(9, await getActivityCutoff())).rejects.toMatchObject({ cause: { code: '23514' } })
    expect(await countUnseenActivityTickets(9)).toBe(3)
    expect(await client`SELECT read FROM notifications`).toEqual([{ read: 0 }, { read: 0 }, { read: 0 }])
  })

  it('rolls back the customer reply and its activity if the bell insert fails', async () => {
    const id = await seed(1, 1, old, old)
    await expect(recordCustomerReply(id, 'Rejected reply')).rejects.toMatchObject({ cause: { code: '23514' } })
    expect(await countUnseenActivityTickets(1)).toBe(0)
    expect(await client`SELECT id FROM ticket_replies`).toEqual([])
    expect(await client`SELECT id FROM ticket_events`).toEqual([])
  })

  it('rechecks the cutoff if the reply writer wins the ticket lock', async () => {
    const id = await seed()
    const cutoff = await getActivityCutoff()
    let bulk: Promise<number> | undefined
    await client.begin(async (tx) => {
      await tx`UPDATE tickets SET last_customer_reply_at = clock_timestamp() WHERE id = ${id}`
      bulk = markAllTicketsSeen(1, cutoff)
      await waitForLock('%WITH seen AS%')
    })
    expect(await bulk).toBe(0)
    expect(await countUnseenActivityTickets(1)).toBe(1)
    expect(await client`SELECT read FROM notifications`).toEqual([{ read: 0 }])
  })

  it('keeps a real reply unseen when its ticket update waits for the bulk writer', async () => {
    const id = await seed()
    const cutoff = await getActivityCutoff()
    let bulk: Promise<number> | undefined
    let reply: Promise<boolean> | undefined
    await client.begin(async (tx) => {
      await tx`SELECT id FROM notifications WHERE ticket_id = ${id} FOR UPDATE`
      bulk = markAllTicketsSeen(1, cutoff)
      await waitForLock('%WITH seen AS%')
      reply = recordCustomerReply(id, 'A new reply')
      await waitForLock('%pg_advisory_xact_lock_shared%')
    })
    expect(await bulk).toBe(1)
    expect(await reply).toBe(true)
    expect(await countUnseenActivityTickets(1)).toBe(1)
    expect(await client`SELECT read FROM notifications ORDER BY id`).toEqual([{ read: 1 }, { read: 0 }])
    expect(await markTicketSeen(id, 1)).toBe(true)
    expect(await countUnseenActivityTickets(1)).toBe(0)
  })

  it('clears the bell row even when bulk clear starts while that reply notification is being inserted', async () => {
    const id = await seed()
    await client`CREATE FUNCTION pause_reply_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(620, NEW.ticket_id);
        RETURN NEW;
      END
    $$`
    await client`CREATE TRIGGER pause_reply_notification BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION pause_reply_notification()`
    let reply: Promise<boolean> | undefined
    let bulk: Promise<number> | undefined
    try {
      await client.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(620, ${id})`
        reply = recordCustomerReply(id, 'Reply with delayed bell insert')
        await waitForLock('insert into "notifications"%')
        bulk = markAllTicketsSeen(1, await getActivityCutoff())
        await waitForLock('%pg_advisory_xact_lock(%')
      })
      expect(await reply).toBe(true)
      expect(await bulk).toBe(1)
      const alerts = await client`SELECT read, message FROM notifications ORDER BY id`
      expect(alerts).toEqual([
        { read: 1, message: null },
        { read: 1, message: 'Customer replied on #7 (Discord): Reply with delayed bell insert' },
      ])
    } finally {
      await Promise.allSettled([reply, bulk])
      await client`DROP TRIGGER pause_reply_notification ON notifications`
      await client`DROP FUNCTION pause_reply_notification()`
    }
  })

  it('lets bulk clear finish before deleting the same ticket', async () => {
    const id = await seed()
    const cutoff = await getActivityCutoff()
    let bulk: Promise<number> | undefined
    let deletion: Promise<void> | undefined
    await client.begin(async (tx) => {
      await tx`SELECT id FROM notifications WHERE ticket_id = ${id} FOR UPDATE`
      bulk = markAllTicketsSeen(1, cutoff)
      await waitForLock('%WITH seen AS%')
      deletion = deleteTicket(id)
      await waitForLock('%pg_advisory_xact_lock(%')
    })
    expect(await bulk).toBe(1)
    await deletion
    expect(await client`SELECT id FROM tickets`).toEqual([])
    expect(await client`SELECT id FROM notifications`).toEqual([])
  }, 12_000)

  it('lets deletion finish before bulk takes its update snapshot', async () => {
    const id = await seed()
    const cutoff = await getActivityCutoff()
    let deletion: Promise<void> | undefined
    let bulk: Promise<number> | undefined
    await client.begin(async (tx) => {
      await tx`SELECT id FROM notifications WHERE ticket_id = ${id} FOR UPDATE`
      deletion = deleteTicket(id)
      await waitForLock('delete from "notifications"%')
      bulk = markAllTicketsSeen(1, cutoff)
      await waitForLock('%pg_advisory_xact_lock(%')
    })
    await deletion
    expect(await bulk).toBe(0)
    expect(await client`SELECT id FROM tickets`).toEqual([])
    expect(await client`SELECT id FROM notifications`).toEqual([])
  }, 12_000)

  it('commits a reply to another ticket while the first reply in the workspace is waiting', async () => {
    const firstId = await seed()
    const secondId = await seed()
    let first: Promise<boolean> | undefined
    await client.begin(async (tx) => {
      // Allow the reply's FK check through, then block its ticket UPDATE.
      await tx`SELECT id FROM tickets WHERE id = ${firstId} FOR NO KEY UPDATE`
      first = recordCustomerReply(firstId, 'Blocked reply')
      await waitForLock('update "tickets"%')
      expect(await recordCustomerReply(secondId, 'Independent reply')).toBe(true)
      expect(await tx`SELECT ticket_id FROM ticket_replies`).toEqual([{ ticket_id: secondId }])
    })
    expect(await first).toBe(true)
    expect(await client`SELECT count(*)::int AS count FROM ticket_replies`).toEqual([{ count: 2 }])
  }, 12_000)

  it('commits a reply in a different workspace while bulk holds the exclusive lock', async () => {
    const firstId = await seed()
    const otherId = await seed(2)
    const cutoff = await getActivityCutoff()
    let bulk: Promise<number> | undefined
    await client.begin(async (tx) => {
      await tx`SELECT id FROM notifications WHERE ticket_id = ${firstId} FOR UPDATE`
      bulk = markAllTicketsSeen(1, cutoff)
      await waitForLock('%WITH seen AS%')
      expect(await recordCustomerReply(otherId, 'Reply in another workspace')).toBe(true)
      expect(await tx`SELECT ticket_id FROM ticket_replies`).toEqual([{ ticket_id: otherId }])
    })
    expect(await bulk).toBe(1)
    expect(await countUnseenActivityTickets(2)).toBe(1)
    expect(await client`SELECT read FROM notifications WHERE org_id = 2 ORDER BY id`).toEqual([{ read: 0 }, { read: 0 }])
  }, 12_000)
})
