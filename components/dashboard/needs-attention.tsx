import Link from 'next/link'
import type { Ticket } from '@/types'
import { StatusBadge, CategoryBadge } from '@/components/ui/badge'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

function rowSummary(ticket: Ticket): string {
  if (ticket.ai_summary) return ticket.ai_summary
  const { text, attachments } = parseAttachmentLines(ticket.content)
  return text.slice(0, 80) || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
}

interface Counts {
  slaBreaches: number
  pendingDrafts: number
  needsReview: number
}

/** What a person can act on right now, most urgent first. Zero counts are left out. */
function attentionRows({ slaBreaches, pendingDrafts, needsReview }: Counts) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return [
    {
      key: 'sla',
      count: slaBreaches,
      href: '/tickets?slaBreached=1',
      label: `${plural(slaBreaches, 'ticket is', 'tickets are')} past the response target`,
      tone: 'bg-red-50 text-red-700 ring-red-100',
    },
    {
      key: 'drafts',
      count: pendingDrafts,
      href: '/tickets?pendingDraft=1',
      label: `${plural(pendingDrafts, 'AI draft is', 'AI drafts are')} waiting for approval`,
      tone: 'bg-blue-50 text-blue-700 ring-blue-100',
    },
    {
      key: 'review',
      count: needsReview,
      href: '/tickets?needsReview=1',
      label: `${plural(needsReview, 'answer needs', 'answers need')} a human review`,
      tone: 'bg-amber-50 text-amber-700 ring-amber-100',
    },
  ].filter((row) => row.count > 0)
}

/**
 * The one place on the dashboard that says what to do next: the counts that
 * need a decision (each opens its filtered ticket list), then the oldest
 * unresolved questions.
 */
export function NeedsAttention({ counts, openTickets }: { counts: Counts; openTickets: Ticket[] }) {
  const rows = attentionRows(counts)
  const empty = rows.length === 0 && openTickets.length === 0

  return (
    <section
      aria-labelledby="needs-attention-heading"
      className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_16px_45px_rgba(30,64,175,0.06)]"
    >
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div>
          <h2 id="needs-attention-heading" className="text-sm font-semibold text-slate-950">Needs attention</h2>
          <p className="mt-0.5 text-xs text-slate-500">What your team can act on now</p>
        </div>
        <Link href="/tickets?status=open" className="text-xs font-medium text-brand-600 hover:text-brand-700">
          View all open →
        </Link>
      </div>

      {empty ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-green-50">
            <svg className="h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700">All caught up!</p>
          <p className="mt-1 text-xs text-gray-400">Nothing needs your attention right now.</p>
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="divide-y divide-slate-100 border-b border-slate-100">
              {rows.map((row) => (
                <li key={row.key}>
                  <Link href={row.href} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50/70">
                    <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums ring-1 ${row.tone}`}>
                      {row.count}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-slate-800 group-hover:text-slate-950">{row.label}</span>
                    <span className="text-slate-300 group-hover:text-slate-500" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {openTickets.length > 0 && (
            <>
              <p className="bg-slate-50/50 px-5 py-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-400">
                Oldest open questions
              </p>
              <ul className="divide-y divide-gray-50">
                {openTickets.map((ticket) => (
                  <li key={ticket.id}>
                    <Link href={`/tickets/${ticket.org_ticket_number}`} className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50/70">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-950">{rowSummary(ticket)}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {ticket.source_author_name ?? 'Unknown'} · #{ticket.org_ticket_number}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {ticket.category && <CategoryBadge category={ticket.category} />}
                        <StatusBadge status={ticket.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
