import { getTicketStats, getSLABreachedTickets, getTickets } from '@/lib/db/queries/tickets'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { SLABreachList } from '@/components/dashboard/sla-breach-list'
import Link from 'next/link'
import { StatusBadge, CategoryBadge } from '@/components/ui/badge'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

export const dynamic = 'force-dynamic'

function rowSummary(content: string): string {
  const { text, attachments } = parseAttachmentLines(content)
  return text.slice(0, 80) || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
}

export default async function DashboardPage() {
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const [stats, breachedTickets, recentTickets] = await Promise.all([
    getTicketStats(orgId),
    getSLABreachedTickets(orgId),
    getTickets({ status: 'open' }, orgId).then((t) => t.slice(0, 6)),
  ])

  const firstName = session?.user?.name?.split(' ')[0] ?? 'there'

  return (
    <div className="dashboard-page max-w-7xl space-y-7">

      {/* Header */}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-blue-600">
            <span className="h-px w-5 bg-blue-500" />
            Live workspace
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl">Good to see you, {firstName}</h1>
          <p className="mt-1 text-sm text-slate-500">Here&rsquo;s what&rsquo;s happening in your community today.</p>
        </div>
        <Link
          href="/tickets"
          className="flex items-center gap-1.5 self-start rounded-lg bg-[#082e50] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:brightness-110"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          View all tickets
        </Link>
      </div>

      {/* Stats */}
      <StatsCards {...stats} />

      {/* Body grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Recent tickets — wider */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_16px_45px_rgba(30,64,175,0.06)] lg:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Open tickets</h2>
              <p className="mt-0.5 text-xs text-slate-500">Oldest unresolved questions</p>
            </div>
            <Link href="/tickets" className="text-xs text-brand-600 hover:text-brand-700 font-medium">
              View all →
            </Link>
          </div>
          {recentTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 mb-3">
                <svg className="h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">All caught up!</p>
              <p className="text-xs text-gray-400 mt-1">No open tickets right now.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {recentTickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link href={`/tickets/${ticket.org_ticket_number}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50/70 transition-colors group">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-950">
                        {ticket.ai_summary ?? rowSummary(ticket.content)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {ticket.source_author_name ?? 'Unknown'} · #{ticket.org_ticket_number}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ticket.category && <CategoryBadge category={ticket.category} />}
                      <StatusBadge status={ticket.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* SLA breaches */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_16px_45px_rgba(30,64,175,0.06)]">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">SLA Status</h2>
                <p className="text-xs text-ink-400">Tickets past response time</p>
              </div>
              {stats.slaBreaches > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-[0.625rem] font-bold text-red-600">
                  {stats.slaBreaches}
                </span>
              )}
            </div>
            <div className="p-3">
              <SLABreachList tickets={breachedTickets} />
            </div>
          </div>

          {/* Quick actions */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_16px_45px_rgba(30,64,175,0.06)]">
            <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-950">Quick actions</h2>
            </div>
            <div className="p-3 space-y-1">
              {[
                { href: '/kb', label: 'Add to Knowledge Base', icon: (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                  </svg>
                )},
                { href: '/analytics', label: 'View deflection trends', icon: (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>
                  </svg>
                )},
                { href: '/settings', label: 'Configure AI settings', icon: (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                )},
                { href: '/faq', label: 'Review FAQ answers', icon: (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                )},
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-blue-50 hover:text-slate-950"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-400 transition-colors group-hover:bg-blue-100 group-hover:text-blue-600">{action.icon}</span>
                  {action.label}
                  <svg className="h-3.5 w-3.5 ml-auto text-ink-300 group-hover:text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
