import Link from 'next/link'
import {
  getDeflectionStats,
  getDeflectionTrend,
  getCategoryBreakdown,
  getDocGaps,
  getSLAStats,
} from '@/lib/db/queries/analytics'
import { getDeflectionAccuracyByCategory } from '@/lib/db/queries/feedback'
import { getCsatStats } from '@/lib/db/queries/csat'
import { computeSavings, deflectionRate } from '@/lib/analytics/roi'
import { getOrgROIConfig } from '@/lib/db/queries/orgs'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { PLANS } from '@/lib/billing/plans'

export const dynamic = 'force-dynamic'

const pct = (n: number) => `${Math.round(n * 100)}%`
const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const hours = (n: number) => `${n.toFixed(1)}h`

function Bar({ value, max, className = 'bg-brand-500' }: { value: number; max: number; className?: string }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-2 flex-1 rounded-full bg-gray-100">
      <div className={`h-2 rounded-full ${className}`} style={{ width: `${width}%` }} />
    </div>
  )
}

export default async function AnalyticsPage() {
  const session = await auth()
  const orgId = (session as { orgId?: number }).orgId ?? DEFAULT_ORG_ID
  const stats = await getDeflectionStats(orgId)
  const rate = deflectionRate(stats.deflected, stats.answered)
  const roiConfig = await getOrgROIConfig(orgId)
  const savings = computeSavings(stats.deflected, roiConfig)
  const trend = await getDeflectionTrend(14, orgId)
  const categories = await getCategoryBreakdown(orgId)
  const docGaps = await getDocGaps(20, orgId)
  const sla = await getSLAStats(orgId)
  const accuracyByCategory = await getDeflectionAccuracyByCategory(orgId)
  const csatUnlocked = await orgHasFeature(orgId, 'csat_scoring')
  const csat = csatUnlocked ? await getCsatStats(orgId) : null

  const trendMax = Math.max(1, ...trend.map((t) => t.answered))
  const catMax = Math.max(1, ...categories.map((c) => c.count))
  const responseTotal = sla.responseMet + sla.responseBreached

  return (
    <div className="dashboard-page max-w-6xl space-y-7">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-blue-600">
          <span className="h-px w-6 bg-blue-500" />
          Performance
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">See what the support agent resolves, where it hesitates, and the time your team gets back.</p>
      </div>

      {/* Hero ROI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="relative overflow-hidden rounded-2xl border border-[#375875] bg-[#082e50] p-5 text-white shadow-[0_20px_50px_-28px_rgba(15,23,42,0.3)]">
          <div className="absolute -right-10 -top-16 h-36 w-36 rounded-full bg-blue-400/10 blur-2xl" />
          <p className="relative text-xs font-medium uppercase tracking-wide text-blue-200">Staff time saved</p>
          <p className="relative mt-1 text-3xl font-bold text-white">{hours(savings.hoursSaved)}</p>
          <p className="relative mt-1 text-xs text-blue-100/80">≈ {money(savings.dollarsSaved)} at {money(savings.hourlyRate)}/hr</p>
        </div>
        <div className="rounded-2xl border border-[#c4dfe2] bg-[#dceff0] p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Deflection rate</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{pct(rate)}</p>
          <p className="text-xs text-gray-500 mt-1">{stats.deflected} of {stats.answered} answered auto-resolved</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Questions handled</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{stats.totalTickets}</p>
          <p className="text-xs text-gray-500 mt-1">{savings.minutesPerTicket} min saved per deflection</p>
        </div>
      </div>

      {/* Deflection trend */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Deflection trend (last {trend.length || 0} days)</h2>
        {trend.length === 0 ? (
          <p className="text-sm text-gray-400">No answered questions yet.</p>
        ) : (
          <ul className="space-y-2">
            {trend.map((t) => (
              <li key={t.day} className="flex items-center gap-3 text-xs">
                <span className="w-20 shrink-0 text-gray-400">{t.day.slice(5)}</span>
                <Bar value={t.deflected} max={trendMax} className="bg-green-500" />
                <span className="w-24 shrink-0 text-right text-gray-500">
                  {t.deflected}/{t.answered} deflected
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trending topics */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Trending topics</h2>
          <ul className="space-y-2">
            {categories.map((c) => (
              <li key={c.category} className="flex items-center gap-3 text-xs">
                <span className="w-32 shrink-0 capitalize text-gray-600">{c.category.replace(/_/g, ' ')}</span>
                <Bar value={c.count} max={catMax} />
                <span className="w-6 shrink-0 text-right text-gray-500">{c.count}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* SLA attainment */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">SLA & responsiveness</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Response SLA met</dt>
              <dd className="font-medium text-gray-900">
                {responseTotal > 0 ? pct(sla.responseMet / responseTotal) : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Avg. time to first response</dt>
              <dd className="font-medium text-gray-900">
                {sla.avgFirstResponseMinutes != null ? `${Math.round(sla.avgFirstResponseMinutes)} min` : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">SLA breaches</dt>
              <dd className="font-medium text-gray-900">{sla.responseBreached + sla.resolveBreached}</dd>
            </div>
          </dl>
        </section>

        {/* CSAT */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Customer satisfaction (CSAT)</h2>
          {!csat ? (
            <p className="text-xs text-gray-400">
              CSAT scoring is available on the {PLANS[planRequiredFor('csat_scoring')].name} plan and above.{' '}
              <a href="/billing" className="font-medium text-brand-600 hover:underline">Upgrade to unlock →</a>
            </p>
          ) : csat.totalRatings === 0 ? (
            <p className="text-xs text-gray-400">No ratings yet. CSAT prompts post automatically after AI answers.</p>
          ) : (
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">Avg. rating</dt>
                <dd className="font-bold text-2xl text-gray-900">
                  {csat.avgRating}/5
                  <span className="text-yellow-400 ml-1 text-base">{'★'.repeat(Math.round(csat.avgRating ?? 0))}</span>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Total ratings</dt>
                <dd className="font-medium text-gray-900">{csat.totalRatings}</dd>
              </div>
              <div className="space-y-1 pt-1">
                {[5, 4, 3, 2, 1].map((star) => {
                  const row = csat.breakdown.find((b) => b.rating === star)
                  const count = row?.count ?? 0
                  const barPct = csat.totalRatings > 0 ? Math.round((count / csat.totalRatings) * 100) : 0
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs">
                      <span className="w-4 text-gray-500 shrink-0">{star}★</span>
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full bg-yellow-400" style={{ width: `${barPct}%` }} />
                      </div>
                      <span className="w-5 text-right text-gray-400 shrink-0">{count}</span>
                    </div>
                  )
                })}
              </div>
            </dl>
          )}
        </section>
      </div>

      {/* Answer quality by category */}
      {accuracyByCategory.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Answer quality by category</h2>
          <p className="text-xs text-gray-400 mb-3">
            👍/👎 feedback on auto-deflected answers, broken down by topic.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 text-left">
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium text-right">Deflected</th>
                  <th className="pb-2 font-medium text-right">👍</th>
                  <th className="pb-2 font-medium text-right">👎</th>
                  <th className="pb-2 font-medium text-right">Approval</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {accuracyByCategory.map((row) => {
                  const rated = row.positive + row.negative
                  const approval = rated > 0 ? row.positive / rated : null
                  return (
                    <tr key={row.category}>
                      <td className="py-2 capitalize text-gray-700">{row.category.replace(/_/g, ' ')}</td>
                      <td className="py-2 text-right text-gray-500">{row.deflected}</td>
                      <td className="py-2 text-right text-green-600">{row.positive}</td>
                      <td className="py-2 text-right text-red-500">{row.negative}</td>
                      <td className="py-2 text-right">
                        {approval === null ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <span className={approval >= 0.7 ? 'text-green-600 font-medium' : approval >= 0.4 ? 'text-amber-600 font-medium' : 'text-red-600 font-medium'}>
                            {pct(approval)}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Documentation gaps */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Documentation gaps</h2>
        <p className="text-xs text-gray-400 mb-3">
          Resolved how-to / documentation questions not yet promoted to the knowledge base.
        </p>
        {docGaps.length === 0 ? (
          <p className="text-sm text-gray-400">No gaps — every resolved how-to is in the KB. 🎉</p>
        ) : (
          <ul className="space-y-1.5">
            {docGaps.map((g) => (
              <li key={g.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-gray-400">#{g.org_ticket_number}</span>
                <Link href={`/tickets/${g.org_ticket_number}`} className="text-gray-700 hover:text-brand-600 line-clamp-1">
                  {g.summary}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
