import { eq, and, desc } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { notifications, tickets } from '../schema'
import type { Notification } from '@/types'

function toNotification(row: typeof notifications.$inferSelect): Notification {
  return {
    id: row.id,
    ticket_id: row.ticketId,
    type: row.type as Notification['type'],
    message: row.message,
    read: row.read as 0 | 1,
    created_at: row.createdAt,
  }
}

export async function createNotification(
  type: Notification['type'],
  message: string,
  ticketId: number | null,
  orgId: number
): Promise<Notification> {
  const [row] = await getDb()
    .insert(notifications)
    .values({ orgId, type, message, ticketId: ticketId ?? null })
    .returning()
  return toNotification(row)
}

export async function getUnreadCount(orgId: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.orgId, orgId), eq(notifications.read, 0)))
  return row?.n ?? 0
}

/**
 * The bell's list: this organization's most recent notifications, newest
 * first, each with the number of the ticket it links to (the number people see
 * in the dashboard, not the internal id). A notification whose ticket was
 * deleted keeps its text and has no link.
 */
export async function getRecentNotifications(orgId: number, limit = 20): Promise<Array<Notification & { ticket_number: number | null }>> {
  const rows = await getDb()
    .select({ n: notifications, ticketNumber: tickets.orgTicketNumber })
    .from(notifications)
    .leftJoin(tickets, and(eq(tickets.id, notifications.ticketId), eq(tickets.orgId, notifications.orgId)))
    .where(eq(notifications.orgId, orgId))
    // By id, not created_at: that column is text, and ids only ever grow.
    .orderBy(desc(notifications.id))
    .limit(limit)
  return rows.map((r) => {
    const notification = toNotification(r.n)
    // Postgres writes "2026-10-29 21:02:03+00"; Safari can't parse the space.
    const at = new Date(notification.created_at)
    return {
      ...notification,
      created_at: Number.isNaN(at.getTime()) ? notification.created_at : at.toISOString(),
      ticket_number: r.ticketNumber ?? null,
    }
  })
}

/** Marks every unread notification in the organization read. Returns how many changed. */
export async function markAllNotificationsRead(orgId: number): Promise<number> {
  const rows = await getDb()
    .update(notifications)
    .set({ read: 1 })
    .where(and(eq(notifications.orgId, orgId), eq(notifications.read, 0)))
    .returning({ id: notifications.id })
  return rows.length
}
