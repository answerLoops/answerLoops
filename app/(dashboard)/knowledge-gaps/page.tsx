import { auth } from '@/auth'
import { getKnowledgeGaps, getGapCategorySummary } from '@/lib/db/queries/analytics'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { LockedFeature } from '@/components/billing/locked-feature'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const REASON_LABEL: Record<string, { label: string; color: string }> = {
  low_confidence:  { label: 'Low AI confidence', color: 'bg-amber-100 text-amber-700' },
  needs_human:     { label: 'Needs human',        color: 'bg-red-100 text-red-700' },
  no_kb_article:   { label: 'Missing KB article', color: 'bg-blue-100 text-blue-700' },
}

const CATEGORY_LABEL: Record<string, string> = {
  how_to:          'How-to',
  documentation:   'Documentation',
  bug:             'Bug',
  feature_request: 'Feature Request',
  general_question:'General Question',
  uncategorized:   'Uncategorized',
}

export default async function KnowledgeGapsPage() {
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID

  if (!(await orgHasFeature(orgId, 'knowledge_gap_dashboard'))) {
    return (
      <div className="dashboard-page max-w-6xl">
        <LockedFeature requiredPlan={planRequiredFor('knowledge_gap_dashboard')} featureLabel="The knowledge gap dashboard" />
      </div>
    )
  }

  const [gaps, categorySummary] = await Promise.all([
    getKnowledgeGaps(50, orgId),
    getGapCategorySummary(orgId),
  ])

  const totalGaps = gaps.length
  const needsHuman = gaps.filter((g) => g.gap_reason === 'needs_human').length
  const lowConf = gaps.filter((g) => g.gap_reason === 'low_confidence').length
  const missingKB = gaps.filter((g) => g.gap_reason === 'no_kb_article').length

  return (
    <div className="dashboard-page max-w-6xl space-y-7">

      {/* Header */}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-blue-600">
            <span className="h-px w-6 bg-blue-500" />
            Improvement queue
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Knowledge Gaps</h1>
          <p className="mt-1 text-sm text-slate-500">Turn uncertain answers into the next best additions to your knowledge base.</p>
        </div>
        <Link
          href="/kb"
          className="flex items-center gap-1.5 self-start rounded-lg bg-[#082e50] px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-600/20 transition-transform hover:-translate-y-0.5"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add to Knowledge Base
        </Link>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total gaps',        value: totalGaps,  color: 'text-white',      bg: 'bg-[#252525] border-slate-700 [&>p:first-child]:text-blue-200' },
          { label: 'Needs human',       value: needsHuman, color: 'text-red-700',    bg: 'bg-red-50 border-red-100' },
          { label: 'Low confidence',    value: lowConf,    color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-100' },
          { label: 'Missing KB article',value: missingKB,  color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-100' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.bg}`}>
            <p className="text-xs font-medium text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Gap list */}
        <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Gap tickets</h2>
            <p className="text-xs text-gray-400">Create a KB article to close each gap</p>
          </div>

          {gaps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 mb-3">
                <svg className="h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">No gaps found</p>
              <p className="text-xs text-gray-400 mt-1">AI is answering everything confidently.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {gaps.map((gap) => {
                const reason = REASON_LABEL[gap.gap_reason] ?? REASON_LABEL.no_kb_article
                const confPct = gap.confidence != null ? Math.round(gap.confidence * 100) : null
                return (
                  <li key={gap.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50/70 transition-colors group">
                    <div className="flex-1 min-w-0">
                      <Link href={`/tickets/${gap.org_ticket_number}`} className="text-sm text-gray-800 truncate group-hover:text-gray-900 hover:underline block">
                        {gap.summary}
                      </Link>
                      <div className="flex items-center gap-2 mt-1">
                        {gap.category && (
                          <span className="text-[0.625rem] text-gray-400">{CATEGORY_LABEL[gap.category] ?? gap.category}</span>
                        )}
                        {confPct != null && (
                          <span className="text-[0.625rem] text-gray-400">{confPct}% confidence</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[0.625rem] font-medium px-2 py-0.5 rounded-full ${reason.color}`}>
                        {reason.label}
                      </span>
                      <Link
                        href={`/kb?sourceTicket=${gap.id}`}
                        className="text-[0.625rem] font-medium text-brand-600 hover:text-brand-700 border border-brand-200 rounded-full px-2 py-0.5 hover:bg-brand-50 transition-colors"
                      >
                        + KB
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Category breakdown */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Gaps by category</h2>
            <p className="text-xs text-gray-400">Where to focus first</p>
          </div>
          {categorySummary.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-gray-400">No data yet</div>
          ) : (
            <ul className="divide-y divide-gray-50 p-3 space-y-1">
              {categorySummary.map((c) => {
                const maxCount = categorySummary[0]?.count ?? 1
                const pct = Math.round((c.count / maxCount) * 100)
                const avgConf = c.avg_confidence != null ? Math.round(Number(c.avg_confidence) * 100) : null
                return (
                  <li key={c.category} className="px-2 py-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-gray-700">
                        {CATEGORY_LABEL[c.category] ?? c.category}
                      </span>
                      <div className="flex items-center gap-2">
                        {avgConf != null && (
                          <span className="text-[0.625rem] text-gray-400">{avgConf}% avg</span>
                        )}
                        <span className="text-xs font-semibold text-gray-900">{c.count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-400 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {/* CTA */}
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-500 mb-2">Every KB article you add closes a gap and improves deflection rate.</p>
            <Link
              href="/kb"
              className="block w-full text-center rounded-lg border border-brand-200 py-2 text-xs font-medium text-brand-600 hover:bg-brand-50 transition-colors"
            >
              Open Knowledge Base →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
