import Link from 'next/link'
import { ActivityDisclosure } from '@/components/dashboard/activity-disclosure'
import { LocalDate } from '@/components/ui/local-date'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'
import { platformLabel } from '@/lib/tickets/platform-label'
import type { Ticket } from '@/types'

export const ACTIVITY_PREVIEW_LIMIT = 5
const ACTIVITY_HEADING_ID = 'activity-heading'

function title(ticket: Ticket): string {
  if (ticket.ai_summary) return ticket.ai_summary
  const { text, attachments } = parseAttachmentLines(ticket.content)
  return text.slice(0, 80) || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
}

/**
 * Tickets the customer has written on since the team last opened them, most
 * recent first. Shows nothing when there is nothing new, so a quiet workspace
 * has no empty box on its dashboard.
 */
export function ActivityPanel({ tickets, total, snapshot, proof }: {
  tickets: Ticket[]
  total: number
  snapshot?: string
  proof?: string
}) {
  const viewAll = (
    <Link href="/tickets?newActivity=1&sort=activity" prefetch={false} className="inline-flex min-h-11 shrink-0 items-center text-xs font-medium text-brand-600 hover:text-brand-700">
      View all {total} →
    </Link>
  )
  return (
    <ActivityDisclosure
      headingId={ACTIVITY_HEADING_ID}
      total={tickets.length ? total : 0}
      viewAll={viewAll}
      previewNote={total > ACTIVITY_PREVIEW_LIMIT ? `Showing the latest ${ACTIVITY_PREVIEW_LIMIT} of ${total}` : undefined}
      snapshot={snapshot}
      proof={proof}
    >
      <ul className="divide-y divide-blue-100">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <Link
              href={`/tickets/${ticket.org_ticket_number}`}
              prefetch={false}
              className="flex flex-col gap-1 px-5 py-3 transition hover:bg-white sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <span className="min-w-0">
                <span className="block break-words text-sm font-medium text-slate-900 line-clamp-2">
                  <span className="mr-1.5 text-xs font-normal text-slate-400">#{ticket.org_ticket_number}</span>
                  {title(ticket)}
                </span>
                <span className="block break-words text-xs text-slate-500">
                  {ticket.source_author_name ?? 'A customer'} on {platformLabel(ticket.source_platform)}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-400">
                <LocalDate iso={ticket.last_customer_reply_at ?? ticket.last_activity_at} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </ActivityDisclosure>
  )
}
