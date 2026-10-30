import { hasNewActivity } from '@/lib/tickets/activity'
import type { Ticket } from '@/types'

/** Marks a ticket whose customer wrote since the team last opened it. */
export function NewActivityBadge({ ticket }: { ticket: Pick<Ticket, 'last_customer_reply_at' | 'last_seen_at'> }) {
  if (!hasNewActivity(ticket)) return null
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-blue-600 px-2 py-0.5 text-[0.6875rem] font-semibold text-white">
      New activity
    </span>
  )
}
