import type { Ticket } from '@/types'

/**
 * Whether the customer has written on a ticket since the team last opened it.
 * The same rule the Activity panel and the "new activity" filter apply in SQL,
 * for rows already loaded.
 */
export function hasNewActivity(ticket: Pick<Ticket, 'last_customer_reply_at' | 'last_seen_at'>): boolean {
  if (!ticket.last_customer_reply_at) return false
  if (!ticket.last_seen_at) return true
  return Date.parse(ticket.last_customer_reply_at) > Date.parse(ticket.last_seen_at)
}
