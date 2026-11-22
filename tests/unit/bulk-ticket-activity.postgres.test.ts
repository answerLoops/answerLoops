import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import { getTableColumns, is } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as tables from '@/lib/db/schema'
import { tickets } from '@/lib/db/schema'
import { hardPurgeOrg } from '@/lib/db/queries/orgs'
import { deleteTicket, getTickets, getUnseenActivityTickets, markAllTicketsSeen, markTicketSeen, recordCustomerReply } from '@/lib/db/queries/tickets'

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
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`CREATE SCHEMA ${admin(schema)}`
    client = postgres(url!, {
      prepare: false,
      onnotice: () => {},
      connection: { search_path: `${schema},pg_catalog`, application_name: schema, lock_timeout: 5_000, statement_timeout: 8_000 },
    })
    state.getDb.mockReturnValue(drizzle(client))
    // Use the real ticket column types so the production reply query can read
    // the full row. Only the tables used by these queries are needed here.
    const columns = Object.values(getTableColumns(tickets)).flatMap((column) => {
      if (column.name === 'last_customer_reply_xid') return []
      if (column.name === 'id') return 'id serial primary key'
      if (column.name === 'last_activity_at') return 'last_activity_at timestamptz not null default now()'
      return `"${column.name}" ${column.getSQLType()}`
    })
    await client.unsafe(`CREATE TABLE tickets (${columns.join(', ')})`)
    await client.unsafe(await readFile('drizzle/0082_ticket_reply_transaction.sql', 'utf8'))
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
    await client`CREATE TABLE kb_articles (org_id int, source_ticket_id int references tickets(id))`
    await client`CREATE TABLE ticket_links (ticket_id int references tickets(id), related_id int references tickets(id))`
    for (const table of ['ticket_embeddings', 'ticket_feedback', 'answer_messages', 'csat_messages', 'csat_ratings', 'ai_assessments']) {
      await client`CREATE TABLE ${client(table)} (org_id int, ticket_id int references tickets(id))`
    }
    await client`CREATE TABLE orgs (id int primary key)`
    // The rest of the purge only filters these tables by organization.
    for (const table of Object.values(tables)) {
      if (!is(table, PgTable)) continue
      const config = getTableConfig(table)
      if (config.columns.some((column) => column.name === 'org_id')) {
        await client`CREATE TABLE IF NOT EXISTS ${client(config.name)} (org_id int references orgs(id))`
      }
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
    await client`INSERT INTO notifications (org_id, ticket_id, type)
      SELECT ${org}, unnest(${rows.map(({ id }) => id)}::int[]), 'ticket_activity'
    `
    return rows[0].id
  }

  // An independent oracle for the unseen rule, so the production query is not
  // used to check itself.
  async function countUnseen(org: number, cutoff?: string) {
    const [row] = await client<{ n: number }[]>`
      SELECT count(*)::int AS n FROM tickets
      WHERE org_id = ${org} AND last_customer_reply_at IS NOT NULL
        AND (last_seen_at IS NULL OR last_customer_reply_at > last_seen_at)
        AND (${cutoff ?? null}::timestamptz IS NULL OR last_customer_reply_at <= ${cutoff ?? null}::timestamptz)
    `
    return row.n
  }

  async function captureSnapshot(cutoff?: string) {
    const [row] = await client<{ snapshot: string }[]>`
      SELECT coalesce(${cutoff ?? null}, to_char(statement_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) || '|' || pg_current_snapshot()::text AS snapshot
    `
    return row.snapshot
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
    expect(await markAllTicketsSeen(1, await captureSnapshot())).toBe(0)
  })

  it('includes the cutoff itself and excludes a reply one microsecond later', async () => {
    const cutoff = '2020-10-02T00:00:00.123456Z'
    await seed(1, 1, cutoff)
    await seed(1, 1, '2020-10-02T00:00:00.123457Z')
    expect(await countUnseen(1, cutoff)).toBe(1)
    expect(await markAllTicketsSeen(1, await captureSnapshot(cutoff))).toBe(1)
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
      expect(await markAllTicketsSeen(1, await captureSnapshot(cutoff))).toBe(count)
      expect(await countUnseen(1)).toBe(1 - count)
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
    await client`INSERT INTO notifications (org_id, ticket_id, type) VALUES
      (2, ${matching}, 'ticket_activity'), (1, NULL, 'ticket_activity')`
    await client`INSERT INTO notifications (org_id, ticket_id, type) VALUES
      (1, ${matching}, 'escalation'), (1, ${matching}, 'sla_breach'), (1, ${matching}, 'new_ticket')`
    const { snapshot, total, tickets: preview } = await getUnseenActivityTickets(1, 5)
    expect(total).toBe(size)
    expect(preview).toHaveLength(Math.min(size, 5))
    expect(await markAllTicketsSeen(1, snapshot!)).toBe(size)
    expect(await markAllTicketsSeen(1, snapshot!)).toBe(0)
    expect(await countUnseen(1)).toBe(1)
    expect(await countUnseen(2)).toBe(1)
    const unread = await client`SELECT org_id, ticket_id FROM notifications WHERE read = 0 ORDER BY id`
    expect(unread).toEqual([
      { org_id: 1, ticket_id: seen }, { org_id: 1, ticket_id: noReply },
      { org_id: 1, ticket_id: newer }, { org_id: 2, ticket_id: otherOrg },
      { org_id: 2, ticket_id: matching }, { org_id: 1, ticket_id: null },
      ...Array.from({ length: 3 }, () => ({ org_id: 1, ticket_id: matching })),
    ])
    const [row] = await client`SELECT status, last_seen_at >= ${snapshot!.split('|')[0]}::timestamptz AS seen_now FROM tickets WHERE id = ${matching}`
    expect(row).toEqual({ status: 'open', seen_now: true })
  })

  it('rolls back all tickets when a notification update fails', async () => {
    await seed(9, 3)
    await expect(markAllTicketsSeen(9, await captureSnapshot())).rejects.toMatchObject({ cause: { code: '23514' } })
    expect(await countUnseen(9)).toBe(3)
    expect(await client`SELECT read FROM notifications`).toEqual([{ read: 0 }, { read: 0 }, { read: 0 }])
  })

  it('rolls back the customer reply and its activity if the bell insert fails', async () => {
    const id = await seed(1, 1, old, old)
    await expect(recordCustomerReply(id, 'Rejected reply')).rejects.toMatchObject({ cause: { code: '23514' } })
    expect(await countUnseen(1)).toBe(0)
    expect(await client`SELECT id FROM ticket_replies`).toEqual([])
    expect(await client`SELECT id FROM ticket_events`).toEqual([])
  })

  it('rechecks the cutoff if the reply writer wins the ticket lock', async () => {
    const id = await seed()
    const snapshot = await captureSnapshot()
    let bulk: Promise<number> | undefined
    await client.begin(async (tx) => {
      await tx`UPDATE tickets SET last_customer_reply_at = clock_timestamp() WHERE id = ${id}`
      bulk = markAllTicketsSeen(1, snapshot)
      await waitForLock('%WITH seen AS%')
    })
    expect(await bulk).toBe(0)
    expect(await countUnseen(1)).toBe(1)
    expect(await client`SELECT read FROM notifications`).toEqual([{ read: 0 }])
  })

  it('keeps a real reply unseen when its ticket update waits for the bulk writer', async () => {
    const id = await seed()
    const snapshot = await captureSnapshot()
    let bulk: Promise<number> | undefined
    let reply: Promise<boolean | null> | undefined
    await client.begin(async (tx) => {
      await tx`SELECT id FROM notifications WHERE ticket_id = ${id} FOR UPDATE`
      bulk = markAllTicketsSeen(1, snapshot)
      await waitForLock('%WITH seen AS%')
      reply = recordCustomerReply(id, 'A new reply')
      await waitForLock('%pg_advisory_xact_lock_shared%')
    })
    expect(await bulk).toBe(1)
    expect(await reply).toBe(true)
    expect(await countUnseen(1)).toBe(1)
    expect(await client`SELECT read FROM notifications ORDER BY id`).toEqual([{ read: 1 }, { read: 0 }])
    expect(await markTicketSeen(id, 1)).toBe(true)
    expect(await countUnseen(1)).toBe(0)
  })

  it.each([false, true])('keeps a reply that commits after load unseen (ticket previously visible: %s)', async (visible) => {
    const id = await seed(1, 1, old, visible ? null : old)
    const other = await seed()
    await client`CREATE FUNCTION pause_reply_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(620, NEW.ticket_id);
        RETURN NEW;
      END
    $$`
    await client`CREATE TRIGGER pause_reply_notification BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION pause_reply_notification()`
    let reply: Promise<boolean | null> | undefined
    let bulk: Promise<number> | undefined
    let dashboardSnapshot: string | undefined
    try {
      await client.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(620, ${id})`
        reply = recordCustomerReply(id, 'Reply with delayed bell insert')
        await waitForLock('insert into "notifications"%')
        const activity = await getUnseenActivityTickets(1, 5)
        expect(activity.total).toBe(visible ? 2 : 1)
        expect(activity.tickets.map((ticket) => ticket.id)).toEqual(visible ? [other, id] : [other])
        dashboardSnapshot = activity.snapshot
        bulk = markAllTicketsSeen(1, dashboardSnapshot!)
        await waitForLock('%pg_advisory_xact_lock(%')
      })
      expect(await reply).toBe(true)
      const [row] = await client`SELECT last_customer_reply_at <= ${dashboardSnapshot!.split('|')[0]}::timestamptz
        AS before_cutoff FROM tickets WHERE id = ${id}`
      expect(row.before_cutoff).toBe(true)
      expect(await bulk).toBe(1)
      expect(await countUnseen(1)).toBe(1)
      expect(await client`SELECT ticket_id, read, message FROM notifications ORDER BY id`).toEqual([
        { ticket_id: id, read: 0, message: null },
        { ticket_id: other, read: 1, message: null },
        { ticket_id: id, read: 0, message: 'Customer replied on #7 (Discord): Reply with delayed bell insert' },
      ])
      const refreshed = await getUnseenActivityTickets(1, 5)
      expect(await markAllTicketsSeen(1, refreshed.snapshot!)).toBe(1)
      expect(await client`SELECT read FROM notifications ORDER BY id`).toEqual([{ read: 1 }, { read: 1 }, { read: 1 }])
    } finally {
      await Promise.allSettled([reply, bulk])
      await client`DROP TRIGGER pause_reply_notification ON notifications`
      await client`DROP FUNCTION pause_reply_notification()`
    }
  })

  it('lets bulk clear finish before deleting the same ticket', async () => {
    const id = await seed()
    const snapshot = await captureSnapshot()
    let bulk: Promise<number> | undefined
    let deletion: Promise<void> | undefined
    await client.begin(async (tx) => {
      await tx`SELECT id FROM notifications WHERE ticket_id = ${id} FOR UPDATE`
      bulk = markAllTicketsSeen(1, snapshot)
      await waitForLock('%WITH seen AS%')
      deletion = deleteTicket(id)
      await waitForLock('%pg_advisory_xact_lock(%')
    })
    expect(await bulk).toBe(1)
    await deletion
    expect(await client`SELECT id FROM tickets`).toEqual([])
    expect(await client`SELECT id FROM notifications`).toEqual([])
  }, 12_000)

  it('waits for a reply before purging its workspace and all reply records', async () => {
    const id = await seed()
    const other = await seed(2)
    await client`INSERT INTO orgs (id) VALUES (1), (2)`
    let reply: Promise<boolean | null> | undefined
    let purge: Promise<void> | undefined
    try {
      await client.begin(async (tx) => {
        await tx`SELECT id FROM tickets WHERE id = ${id} FOR NO KEY UPDATE`
        reply = recordCustomerReply(id, 'Reply during purge')
        await waitForLock('update "tickets"%')
        purge = hardPurgeOrg(1)
        await waitForLock('%pg_advisory_xact_lock(%')
      })
      expect(await reply).toBe(true)
      await purge
      expect(await client`SELECT id FROM orgs ORDER BY id`).toEqual([{ id: 2 }])
      expect(await client`SELECT id FROM tickets ORDER BY id`).toEqual([{ id: other }])
      expect(await client`SELECT ticket_id FROM notifications ORDER BY id`).toEqual([{ ticket_id: other }])
      expect(await client`SELECT id FROM ticket_replies`).toEqual([])
      expect(await client`SELECT id FROM ticket_events`).toEqual([])
    } finally {
      await Promise.allSettled([reply, purge])
    }
  }, 12_000)

  it('lets deletion finish before bulk takes its update snapshot', async () => {
    const id = await seed()
    const snapshot = await captureSnapshot()
    let deletion: Promise<void> | undefined
    let bulk: Promise<number> | undefined
    await client.begin(async (tx) => {
      await tx`SELECT id FROM notifications WHERE ticket_id = ${id} FOR UPDATE`
      deletion = deleteTicket(id)
      await waitForLock('delete from "notifications"%')
      bulk = markAllTicketsSeen(1, snapshot)
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
    let first: Promise<boolean | null> | undefined
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
    const snapshot = await captureSnapshot()
    let bulk: Promise<number> | undefined
    await client.begin(async (tx) => {
      await tx`SELECT id FROM notifications WHERE ticket_id = ${firstId} FOR UPDATE`
      bulk = markAllTicketsSeen(1, snapshot)
      await waitForLock('%WITH seen AS%')
      expect(await recordCustomerReply(otherId, 'Reply in another workspace')).toBe(true)
      expect(await tx`SELECT ticket_id FROM ticket_replies`).toEqual([{ ticket_id: otherId }])
    })
    expect(await bulk).toBe(1)
    expect(await countUnseen(2)).toBe(1)
    expect(await client`SELECT read FROM notifications WHERE org_id = 2 ORDER BY id`).toEqual([{ read: 0 }, { read: 0 }])
  }, 12_000)

  it('reports a missing ticket when deletion commits while the reply waits for the shared lock', async () => {
    const id = await seed()
    let deletion: Promise<void> | undefined
    let reply: Promise<boolean | null> | undefined
    await client.begin(async (tx) => {
      await tx`SELECT id FROM notifications WHERE ticket_id = ${id} FOR UPDATE`
      deletion = deleteTicket(id)
      await waitForLock('delete from "notifications"%')
      reply = recordCustomerReply(id, 'Reply while the ticket is deleted')
      await waitForLock('%pg_advisory_xact_lock_shared%')
    })
    await deletion
    expect(await reply).toBeNull()
    expect(await client`SELECT id FROM ticket_replies`).toEqual([])
    expect(await client`SELECT id FROM ticket_events`).toEqual([])
    expect(await client`SELECT id FROM notifications`).toEqual([])
  }, 12_000)
})
