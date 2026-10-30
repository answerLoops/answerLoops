import Link from 'next/link'
import type { Ticket } from '@/types'
import { StatusBadge, PriorityBadge, CategoryBadge, AIDraftBadge } from '@/components/ui/badge'
import { getSLAStatus } from '@/lib/sla/engine'
import { LocalDate } from '@/components/ui/local-date'
import { NewActivityBadge } from '@/components/tickets/new-activity-badge'
import { GithubReferenceLink } from '@/components/tickets/github-reference'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  discord:  { label: 'Discord',  className: 'bg-indigo-100 text-indigo-700' },
  github:   { label: 'GitHub',   className: 'bg-gray-100 text-gray-700' },
  slack:    { label: 'Slack',    className: 'bg-green-100 text-green-700' },
  telegram: { label: 'Telegram', className: 'bg-sky-100 text-sky-700' },
  discourse: { label: 'Discourse', className: 'bg-orange-100 text-orange-700' },
  circle:   { label: 'Circle',   className: 'bg-violet-100 text-violet-700' },
  email:    { label: 'Email',    className: 'bg-yellow-100 text-yellow-700' },
  mcp:      { label: 'Agent',    className: 'bg-brand-100 text-brand-700' },
}

function PlatformBadge({ platform }: { platform: string | null | undefined }) {
  const p = platform ?? 'discord'
  const badge = PLATFORM_BADGE[p] ?? { label: p, className: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>
      {badge.label}
    </span>
  )
}

function rowSummary(ticket: Ticket): string {
  const { text, attachments } = parseAttachmentLines(ticket.content)
  return text.slice(0, 100) || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
}

function SLAIndicator({ ticket }: { ticket: Ticket }) {
  const sla = getSLAStatus(ticket)
  if (!sla.anyBreached) return null
  return <span className="text-xs font-medium text-red-600">SLA breach</span>
}

export function TicketList({ tickets }: { tickets: Ticket[] }) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-blue-200 bg-[linear-gradient(145deg,#ffffff,#eff6ff)] px-6 py-16 text-center text-sm text-slate-500">
        No tickets found.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-[0_22px_60px_-42px_rgba(15,23,42,0.55)]">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-500">
            <th className="px-4 py-2.5">#</th>
            <th className="px-4 py-2.5">Summary</th>
            <th className="px-4 py-2.5">Source</th>
            <th className="px-4 py-2.5">Category</th>
            <th className="px-4 py-2.5">Priority</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">AI</th>
            <th className="px-4 py-2.5">SLA</th>
            <th className="px-4 py-2.5">Author</th>
            <th className="px-4 py-2.5">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tickets.map((ticket) => (
            <tr key={ticket.id} className="transition-colors hover:bg-blue-50/45">
              <td className="px-4 py-3 text-gray-400">#{ticket.org_ticket_number}</td>
              <td className="px-4 py-3 max-w-xs">
                <Link href={`/tickets/${ticket.org_ticket_number}`} className="line-clamp-2 font-medium text-slate-900 hover:text-blue-700">
                  {ticket.ai_summary ?? rowSummary(ticket)}
                </Link>
                <NewActivityBadge ticket={ticket} />
              </td>
              <td className="px-4 py-3">
                <PlatformBadge platform={ticket.source_platform} />
                {ticket.source_platform === 'github' && <GithubReferenceLink ticket={ticket} variant="list" />}
              </td>
              <td className="px-4 py-3">
                {ticket.category && <CategoryBadge category={ticket.category} />}
              </td>
              <td className="px-4 py-3">
                <PriorityBadge priority={ticket.priority} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={ticket.status} />
              </td>
              <td className="px-4 py-3">
                <AIDraftBadge status={ticket.ai_draft_status} />
              </td>
              <td className="px-4 py-3">
                <SLAIndicator ticket={ticket} />
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs">{ticket.source_author_name ?? '—'}</td>
              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                <LocalDate iso={ticket.created_at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
