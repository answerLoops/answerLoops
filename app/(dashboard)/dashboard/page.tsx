import { getTicketStats, getTickets, getUnseenActivityTickets } from '@/lib/db/queries/tickets'
import { signActivitySnapshot } from '@/lib/tickets/activity-snapshot'
import { getDeflectionStats } from '@/lib/db/queries/analytics'
import { deflectionRate as calculateDeflectionRate } from '@/lib/analytics/roi'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { ACTIVITY_PREVIEW_LIMIT, ActivityPanel } from '@/components/dashboard/activity-panel'
import { VIEW_ALL_TICKETS_ID } from '@/components/dashboard/activity-ids'
import { NeedsAttention } from '@/components/dashboard/needs-attention'
import Link from 'next/link'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const [stats, openTickets, deflectionStats, activity] = await Promise.all([
    getTicketStats(orgId),
    getTickets({ status: 'open' }, orgId, 5),
    getDeflectionStats(orgId),
    getUnseenActivityTickets(orgId, ACTIVITY_PREVIEW_LIMIT),
  ])
  const dashboardDeflectionRate = Math.round(
    calculateDeflectionRate(deflectionStats.deflected, deflectionStats.answered) * 100
  )

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
          id={VIEW_ALL_TICKETS_ID}
          href="/tickets"
          className="self-start rounded-lg bg-[#082e50] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:brightness-110"
        >
          View all tickets
        </Link>
      </div>

      <ActivityPanel
        tickets={activity.tickets}
        total={activity.total}
        channels={activity.channels}
        snapshot={activity.snapshot}
        proof={session?.user?.id && activity.snapshot
          ? signActivitySnapshot(activity.snapshot, orgId, Number(session.user.id))
          : undefined}
      />

      {/* Stats */}
      <StatsCards {...stats} deflectionRate={dashboardDeflectionRate} />

      <NeedsAttention
        counts={{ slaBreaches: stats.slaBreaches, pendingDrafts: stats.pendingDrafts, needsReview: stats.needsReview }}
        openTickets={openTickets}
      />
    </div>
  )
}
