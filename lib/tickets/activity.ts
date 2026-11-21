import type { Ticket } from '@/types'
import { platformLabel } from '@/lib/tickets/platform-label'

export function activitySnippet(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  const limit = 140
  if (flat.length <= limit) return flat
  const cut = flat.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return `${space > limit * 0.6 ? cut.slice(0, space) : cut}…`
}

export function ticketActivityMessage(ticket: Pick<Ticket, 'org_ticket_number' | 'source_platform'>, authorName: string, content: string): string {
  const snippet = activitySnippet(content)
  return `${authorName} replied on #${ticket.org_ticket_number} (${platformLabel(ticket.source_platform)})${snippet ? `: ${snippet}` : ''}`
}

/**
 * Whether the customer has written on a ticket since the team last opened it.
 * The same rule the Activity panel and the "new activity" filter apply in SQL,
 * for rows already loaded.
 */
export function hasNewActivity(ticket: Pick<Ticket, 'last_customer_reply_at' | 'last_seen_at' | 'has_new_activity'>): boolean {
  if (ticket.has_new_activity !== undefined) return ticket.has_new_activity
  if (!ticket.last_customer_reply_at) return false
  if (!ticket.last_seen_at) return true
  return Date.parse(ticket.last_customer_reply_at) > Date.parse(ticket.last_seen_at)
}
