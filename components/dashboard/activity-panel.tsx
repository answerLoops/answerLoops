import Link from 'next/link'
import { ActivityDisclosure } from '@/components/dashboard/activity-disclosure'
import { LocalDate } from '@/components/ui/local-date'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'
import { platformLabel } from '@/lib/tickets/platform-label'
import type { ChannelActivityCount, Ticket } from '@/types'

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
export function ActivityPanel({ tickets, total, channels = [], snapshot, proof }: {
  tickets: Ticket[]
  total: number
  channels?: ChannelActivityCount[]
  snapshot?: string
  proof?: string
}) {
  const viewAll = (
    <Link href="/tickets?newActivity=1&sort=activity" prefetch={false} className="inline-flex min-h-11 shrink-0 items-center text-xs font-medium text-brand-600 hover:text-brand-700">
      View all {total} →
    </Link>
  )

  let chips: React.ReactNode = null
  if (channels.length > 1) {
    const hasOther = channels.length > 4
    const visible = hasOther ? channels.slice(0, 3) : channels.slice(0, 4)
    const otherCount = hasOther ? channels.slice(3).reduce((sum, c) => sum + c.count, 0) : 0

    const chipList = [
      ...visible.map((c) => ({
        key: c.platform,
        label: platformLabel(c.platform),
        count: c.count,
        href: `/tickets?newActivity=1&sort=activity&platform=${encodeURIComponent(c.platform)}`,
      })),
      ...(hasOther
        ? [
            {
              key: 'other',
              label: 'Other',
              count: otherCount,
              href: '/tickets?newActivity=1&sort=activity',
            },
          ]
        : []),
    ]

    chips = (
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {chipList.map(({ key, label, count, href }) => {
          const displayCount = count > 99 ? '99+' : count
          const accessibleName = `${label}, ${count} ${count === 1 ? 'ticket' : 'tickets'} with new replies`

          return (
            <Link
              key={key}
              href={href}
              prefetch={false}
              aria-label={accessibleName}
              className="inline-flex min-h-7 items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <span>{label}</span>
              <span>{displayCount}</span>
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <ActivityDisclosure
      headingId={ACTIVITY_HEADING_ID}
      total={tickets.length ? total : 0}
      chips={chips}
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
