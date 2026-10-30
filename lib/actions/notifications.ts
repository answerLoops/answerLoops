'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { requireOrgAccess } from '@/lib/auth/org'
import { markAllNotificationsRead } from '@/lib/db/queries/notifications'
import { getTicketByOrgTicketNumber, markTicketSeen } from '@/lib/db/queries/tickets'

/** Clears the bell: every unread notification in the workspace becomes read. */
export async function markAllNotificationsReadAction(): Promise<{ ok: boolean }> {
  const access = await requireOrgAccess()
  if (!access.ok) return { ok: false }
  await markAllNotificationsRead(access.orgId)
  refresh()
  return { ok: true }
}

const TicketNumber = z.number().int().positive()

/**
 * The team opened a ticket: its notifications are read and its new activity is
 * seen. Takes the number shown in the dashboard and resolves it inside the
 * caller's own workspace, so a number from another workspace changes nothing.
 */
export async function markTicketSeenAction(ticketNumber: number): Promise<{ ok: boolean }> {
  const parsed = TicketNumber.safeParse(ticketNumber)
  if (!parsed.success) return { ok: false }
  const access = await requireOrgAccess()
  if (!access.ok) return { ok: false }
  const ticket = await getTicketByOrgTicketNumber(parsed.data, access.orgId)
  if (!ticket) return { ok: false }
  const found = await markTicketSeen(ticket.id, access.orgId)
  if (found) refresh()
  return { ok: found }
}
