import { eq, and, desc } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { notifications } from '../schema'
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
