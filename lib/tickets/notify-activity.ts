import { activitySnippet } from '@/lib/tickets/activity'
import { sendPushToAll } from '@/lib/push/notify'
import { platformLabel } from '@/lib/tickets/platform-label'
import { logger } from '@/lib/logger'
import type { Ticket } from '@/types'

const MOD = 'tickets/notify-activity'
/**
 * Sends push after the reply and its bell notification commit. It carries the ticket number,
 * who wrote, where, and a snippet. Its tag is the ticket, so a second reply
 * replaces the first on the device instead of stacking. Call it only for a
 * message that was newly stored: a redelivery has nothing new to announce,
 * which is also what keeps a ticket quiet once its activity has been seen.
 */
export async function notifyTicketActivity(input: {
  ticket: Pick<Ticket, 'id' | 'org_ticket_number' | 'source_platform'>
  authorName: string
  content: string
  orgId: number
}): Promise<void> {
  const { ticket, authorName, orgId } = input
  const number = ticket.org_ticket_number
  const channel = platformLabel(ticket.source_platform)
  const snippet = activitySnippet(input.content)

  try {
    await sendPushToAll({
      title: `New reply on #${number}`,
      body: `${authorName} on ${channel}${snippet ? `: ${snippet}` : ''}`,
      url: `/tickets/${number}`,
      tag: `ticket-${ticket.id}`,
    }, orgId)
  } catch (err) {
    logger.warn('push notification for ticket activity failed', { module: MOD, ticketId: ticket.id, error: err })
  }
}
