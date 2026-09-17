import { getTickets } from '@/lib/db/queries/tickets'
import { TicketList } from '@/components/tickets/ticket-list'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { LockedCsvExportButton } from '@/components/billing/locked-csv-export-button'
import type { TicketStatus, Priority, TicketCategory } from '@/types'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

interface SearchParams {
  status?: string
  priority?: string
  category?: string
}

export default async function TicketsPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const canExportCsv = await orgHasFeature(orgId, 'csv_export')
  const tickets = await getTickets({
    status: searchParams.status as TicketStatus | undefined,
    priority: searchParams.priority as Priority | undefined,
    category: searchParams.category as TicketCategory | undefined,
  }, orgId)

  return (
    <div className="dashboard-page max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-blue-600">
            <span className="h-px w-6 bg-blue-500" />
            Unified inbox
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Tickets</h1>
          <p className="mt-1 text-sm text-slate-500">{tickets.length} conversation{tickets.length !== 1 ? 's' : ''} across every connected channel.</p>
        </div>

        {/* Filter bar */}
        <form className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-2 text-sm shadow-sm">
          <select name="status" defaultValue={searchParams.status ?? ''} className="rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-700 bg-white">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select name="priority" defaultValue={searchParams.priority ?? ''} className="rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-700 bg-white">
            <option value="">All priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select name="category" defaultValue={searchParams.category ?? ''} className="rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-700 bg-white">
            <option value="">All categories</option>
            <option value="bug">Bug</option>
            <option value="feature_request">Feature Request</option>
            <option value="documentation">Documentation</option>
            <option value="how_to">How-to</option>
            <option value="general_question">General Question</option>
          </select>
          <button type="submit" className="rounded-lg bg-[#082e50] px-4 py-2 text-sm font-medium text-white hover:bg-[#184566]">
            Filter
          </button>
          <Link href="/tickets" className="rounded-full px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Clear
          </Link>
          {canExportCsv ? (
            <a
              href="/api/export/tickets"
              className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export CSV
            </a>
          ) : (
            <LockedCsvExportButton className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50" />
          )}
        </form>
      </div>

      <TicketList tickets={tickets} />
    </div>
  )
}
