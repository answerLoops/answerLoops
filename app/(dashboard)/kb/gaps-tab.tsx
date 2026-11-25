'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LockedFeature } from '@/components/billing/locked-feature'
import type { PlanId } from '@/lib/billing/plans'
import type { GapCluster } from '@/lib/ai/gap-clusters'
import type { GapTicketTotals, KnowledgeGap } from '@/lib/db/queries/analytics'

const REASON_LABEL: Record<string, { label: string; color: string }> = {
  low_confidence: { label: 'Low AI confidence', color: 'bg-amber-100 text-amber-700' },
  needs_human: { label: 'Needs human', color: 'bg-red-100 text-red-700' },
  no_kb_article: { label: 'Missing KB article', color: 'bg-blue-100 text-blue-700' },
}

const CATEGORY_LABEL: Record<string, string> = {
  how_to: 'How-to',
  documentation: 'Documentation',
  bug: 'Bug',
  feature_request: 'Feature Request',
  general_question: 'General Question',
  uncategorized: 'Uncategorized',
}

type GapsResponse =
  | { locked: true; requiredPlan: PlanId }
  | { locked: false; totals: GapTicketTotals; clusters: GapCluster<KnowledgeGap>[] }

/**
 * Open knowledge gaps: questions the assistant could not answer well. Each row
 * links to the ticket and to the write-an-answer dialog on the Sources tab.
 */
export function GapsTab() {
  const [data, setData] = useState<GapsResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/kb/gaps')
      .then((res) => (res.ok ? (res.json() as Promise<GapsResponse>) : Promise.reject(new Error(String(res.status)))))
      .then((body) => { if (!cancelled) setData(body) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  if (failed) {
    return <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Could not load knowledge gaps. Refresh to try again.</p>
  }
  if (!data) return <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
  if (data.locked) {
    return <LockedFeature requiredPlan={data.requiredPlan} featureLabel="The knowledge gap dashboard" />
  }

  const { totals, clusters } = data
  const categories = totals.categories
  const tiles = [
    { label: 'Open gap tickets', value: totals.total, tone: 'text-slate-900' },
    { label: 'Needs human', value: totals.needs_human, tone: 'text-red-700' },
    { label: 'Low confidence', value: totals.low_confidence, tone: 'text-amber-700' },
    { label: 'Missing KB article', value: totals.no_kb_article, tone: 'text-blue-700' },
  ]

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">Turn uncertain answers into the next best additions to your knowledge base.</p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <p className={`text-2xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{t.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white lg:col-span-2">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">Distinct questions</h2>
            <p className="text-xs text-gray-400">
              {clusters.length > 0
                ? `Showing the ${clusters.length} most pressing distinct questions, most-asked first. Create a KB article to close each gap`
                : 'Most-asked questions first. Create a KB article to close each gap'}
            </p>
          </div>

          {clusters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <p className="text-sm font-medium text-gray-700">No gaps found</p>
              <p className="mt-1 text-xs text-gray-400">AI is answering everything confidently.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {clusters.map(({ lead: gap, count }) => {
                const reason = REASON_LABEL[gap.gap_reason] ?? REASON_LABEL.no_kb_article
                const confPct = gap.confidence != null ? Math.round(gap.confidence * 100) : null
                return (
                  <li key={gap.id} className="group flex flex-col gap-2 px-5 py-3.5 transition-colors hover:bg-gray-50/70 sm:flex-row sm:items-start sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/tickets/${gap.org_ticket_number}`} className="block truncate text-sm text-gray-800 hover:underline group-hover:text-gray-900">
                        {gap.summary}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {gap.category && (
                          <span className="text-[0.625rem] text-gray-400">{CATEGORY_LABEL[gap.category] ?? gap.category}</span>
                        )}
                        {confPct != null && <span className="text-[0.625rem] text-gray-400">{confPct}% confidence</span>}
                        {count > 1 && (
                          <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-700">
                            Asked {count} times
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:shrink-0">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[0.625rem] font-medium ${reason.color}`}>
                        {reason.label}
                      </span>
                      <Link
                        href={`/kb?sourceTicket=${gap.id}`}
                        className="rounded-full border border-brand-200 px-2 py-0.5 text-[0.625rem] font-medium text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
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

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">Gaps by category</h2>
            <p className="text-xs text-gray-400">Open gap tickets per category</p>
          </div>
          {categories.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-gray-400">No data yet</div>
          ) : (
            <ul className="space-y-1 divide-y divide-gray-50 p-3">
              {categories.map((c) => {
                const pct = Math.round((c.count / (categories[0]?.count ?? 1)) * 100)
                const avgConf = c.avg_confidence != null ? Math.round(Number(c.avg_confidence) * 100) : null
                return (
                  <li key={c.category} className="px-2 py-2">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700">{CATEGORY_LABEL[c.category] ?? c.category}</span>
                      <div className="flex items-center gap-2">
                        {avgConf != null && <span className="text-[0.625rem] text-gray-400">{avgConf}% avg</span>}
                        <span className="text-xs font-semibold text-gray-900">{c.count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-brand-400" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
