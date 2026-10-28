import type { TicketReply, TicketReplyRole } from '@/types'

export type ThreadEntryRole = TicketReplyRole

export interface ThreadEntry {
  id: number
  role: ThreadEntryRole
  author: string
  content: string
  createdAt: string
}

const ROLE_LABEL: Record<ThreadEntryRole, string> = {
  customer: 'Customer',
  staff: 'Staff',
  context: 'Maintainer',
}

export function threadRoleLabel(role: ThreadEntryRole): string {
  return ROLE_LABEL[role]
}

/**
 * The messages after the ticket's opening one, oldest first, whichever channel
 * they came from. The opening message is rendered separately above them.
 * Ordering is by time with the stored id as the tiebreak, so messages written
 * in the same instant keep the order they arrived in.
 */
export function buildTicketThread(replies: TicketReply[]): ThreadEntry[] {
  return [...replies]
    .sort((a, b) => {
      const byTime = Date.parse(a.created_at) - Date.parse(b.created_at)
      return byTime !== 0 && !Number.isNaN(byTime) ? byTime : a.id - b.id
    })
    .map((r) => ({
      id: r.id,
      role: r.author_role,
      author: r.staff_name,
      content: r.content,
      createdAt: r.created_at,
    }))
}
