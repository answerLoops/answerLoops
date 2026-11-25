import { getTickets, getTicketStatusCounts, encodeTicketCursor, decodeTicketCursor } from '@/lib/db/queries/tickets'
import { TicketList } from '@/components/tickets/ticket-list'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { isSourcePlatform } from '@/lib/tickets/platform-label'
import { TicketFilters } from '@/components/tickets/ticket-filters'
import { LockedCsvExportButton } from '@/components/billing/locked-csv-export-button'
import type { TicketStatus, Priority, TicketCategory } from '@/types'
import Link from 'next/link'
import { Page, PageHeader } from '@/components/dashboard/page-shell'

export const dynamic = 'force-dynamic'

interface SearchParams {
  status?: string
  priority?: string
  category?: string
  platform?: string
  autoDeflected?: string
  needsReview?: string
  pendingDraft?: string
  slaBreached?: string
  newActivity?: string
  sort?: string
  cursor?: string
}

// Known Issue 128: this page used to load the org's entire ticket history on
// every render, every column, with no limit at all — the query grew heavier
// as an org aged, with no ceiling. Paginated the same way the Agent API's
// get_tickets already was: fetch one row past the page to know whether
// another page follows, without a second round trip or a COUNT query.
const PAGE_SIZE = 50

// Filters reached from the dashboard stat cards. They have no control in the
// filter bar; they live in the URL and the filter controls carry them along.
const CARD_FILTERS = [
  { param: 'autoDeflected', label: 'Auto-Answered' },
  { param: 'needsReview', label: 'Needs Review' },
  { param: 'pendingDraft', label: 'AI Drafts Pending' },
  { param: 'slaBreached', label: 'SLA Breaches' },
] as const

export default async function TicketsPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const canExportCsv = await orgHasFeature(orgId, 'csv_export')

  const cursor = decodeTicketCursor(searchParams.cursor)
  const filters = {
    status: searchParams.status as TicketStatus | undefined,
    priority: searchParams.priority as Priority | undefined,
    category: searchParams.category as TicketCategory | undefined,
    platform: isSourcePlatform(searchParams.platform) ? searchParams.platform : undefined,
    autoDeflected: searchParams.autoDeflected === '1' || undefined,
    needsReview: searchParams.needsReview === '1' || undefined,
    pendingDraft: searchParams.pendingDraft === '1' || undefined,
    slaBreached: searchParams.slaBreached === '1' || undefined,
    newActivity: searchParams.newActivity === '1' || undefined,
    sort: searchParams.sort === 'activity' ? ('activity' as const) : undefined,
  }
  const [rows, statusCounts] = await Promise.all([
    getTickets(filters, orgId, PAGE_SIZE + 1, cursor ?? undefined, true),
    getTicketStatusCounts(orgId),
  ])
  const hasMore = rows.length > PAGE_SIZE
  const tickets = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const last = tickets[tickets.length - 1]
  const nextCursor = hasMore && last ? encodeTicketCursor({ createdAt: filters.sort === 'activity' ? last.last_activity_at : last.created_at, id: last.id }) : null

  const loadMoreParams = new URLSearchParams()
  if (filters.status) loadMoreParams.set('status', filters.status)
  if (filters.priority) loadMoreParams.set('priority', filters.priority)
  if (filters.category) loadMoreParams.set('category', filters.category)
  if (filters.platform) loadMoreParams.set('platform', filters.platform)
  if (filters.autoDeflected) loadMoreParams.set('autoDeflected', '1')
  if (filters.needsReview) loadMoreParams.set('needsReview', '1')
  if (filters.pendingDraft) loadMoreParams.set('pendingDraft', '1')
  if (filters.slaBreached) loadMoreParams.set('slaBreached', '1')
  if (filters.newActivity) loadMoreParams.set('newActivity', '1')
  if (filters.sort) loadMoreParams.set('sort', filters.sort)
  if (nextCursor) loadMoreParams.set('cursor', nextCursor)

  const activeCardFilters = CARD_FILTERS.filter(({ param }) => filters[param])
  const withoutCardFilters = new URLSearchParams()
  if (filters.status) withoutCardFilters.set('status', filters.status)
  if (filters.priority) withoutCardFilters.set('priority', filters.priority)
  if (filters.category) withoutCardFilters.set('category', filters.category)
  if (filters.platform) withoutCardFilters.set('platform', filters.platform)
  if (filters.sort) withoutCardFilters.set('sort', filters.sort)
  if (filters.newActivity) withoutCardFilters.set('newActivity', '1')
  const clearCardFiltersQuery = withoutCardFilters.toString()
  const clearCardFiltersHref = clearCardFiltersQuery ? `/tickets?${clearCardFiltersQuery}` : '/tickets'

  // Status tabs keep every other filter, so switching tab narrows what you are
  // already looking at instead of starting over.
  const tabHref = (status?: string) => {
    const params = new URLSearchParams(loadMoreParams)
    params.delete('cursor')
    params.delete('status')
    if (status) params.set('status', status)
    const query = params.toString()
    return query ? `/tickets?${query}` : '/tickets'
  }
  const allCount = Object.values(statusCounts).reduce((sum, n) => sum + n, 0)
  const STATUS_TABS = [
    { status: undefined, label: 'All', count: allCount },
    { status: 'open', label: 'Open', count: statusCounts.open },
    { status: 'in_progress', label: 'In progress', count: statusCounts.in_progress },
    { status: 'resolved', label: 'Resolved', count: statusCounts.resolved },
    { status: 'closed', label: 'Closed', count: statusCounts.closed },
    // Duplicates are rarely wanted, so their tab only appears when there are some.
    ...(statusCounts.duplicate > 0 || filters.status === 'duplicate'
      ? [{ status: 'duplicate', label: 'Duplicate', count: statusCounts.duplicate }]
      : []),
  ]

  return (
    <Page>
      <PageHeader
        title="Tickets"
        description={
          <>
            {tickets.length} conversation{tickets.length !== 1 ? 's' : ''} across every connected channel
            {hasMore || cursor ? ' (showing the most recent page)' : ''}.
          </>
        }
        actions={
          <>
            {canExportCsv ? (
              <a
                href="/api/export/tickets"
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export CSV
              </a>
            ) : (
              <LockedCsvExportButton className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" />
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <nav aria-label="Ticket status" className="dashboard-tabs flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
          {STATUS_TABS.map((tab) => {
            const selected = (filters.status ?? undefined) === tab.status
            return (
              <Link
                key={tab.label}
                href={tabHref(tab.status)}
                aria-current={selected ? 'page' : undefined}
                className={[
                  'flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                  selected ? 'bg-[#082e50] text-white shadow-none' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
                ].join(' ')}
              >
                {tab.label}
                <span className={`text-xs tabular-nums ${selected ? 'text-white/70' : 'text-slate-400'}`}>{tab.count}</span>
              </Link>
            )
          })}
        </nav>
        <TicketFilters
          values={{
            priority: filters.priority,
            category: filters.category,
            platform: filters.platform,
            sort: filters.sort,
            newActivity: filters.newActivity,
          }}
        />
      </div>

      {activeCardFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600" data-testid="card-filter-indicator">
          <span>Filtered by</span>
          {activeCardFilters.map(({ param, label }) => (
            <span key={param} className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">
              {label}
            </span>
          ))}
          <Link href={clearCardFiltersHref} className="rounded-full px-3 py-1 text-slate-600 underline hover:bg-gray-50">
            Clear card filter
          </Link>
        </div>
      )}

      <TicketList tickets={tickets} />

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/tickets?${loadMoreParams.toString()}`}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Load more
          </Link>
        </div>
      )}
    </Page>
  )
}
