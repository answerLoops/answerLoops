import Link from 'next/link'
import type { TrendPoint } from '@/lib/db/queries/analytics'
import { TREND_RANGES, type TrendRange } from '@/lib/analytics/trend'

const formatDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * Questions answered per day, split into the ones the AI resolved on its own
 * and the ones a person handled. `points` has one entry per day, quiet days
 * included, so the chart keeps its shape.
 */
export function TrendChart({ points, range }: { points: TrendPoint[]; range: TrendRange }) {
  const answered = points.reduce((sum, p) => sum + p.answered, 0)
  const deflected = points.reduce((sum, p) => sum + p.deflected, 0)
  const max = Math.max(1, ...points.map((p) => p.answered))
  const mid = points[Math.floor(points.length / 2)]

  return (
    <section aria-labelledby="trend-heading" className="rounded-2xl border border-slate-200/80 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="trend-heading" className="text-sm font-semibold text-slate-900">Deflection trend</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {answered === 0
              ? `No answered questions in the last ${range} days.`
              : `${deflected} of ${answered} answered questions resolved automatically in the last ${range} days.`}
          </p>
        </div>
        <nav aria-label="Trend range" className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {TREND_RANGES.map((r) => (
            <Link
              key={r}
              href={`/analytics?range=${r}`}
              aria-current={r === range ? 'page' : undefined}
              scroll={false}
              className={[
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                r === range ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              ].join(' ')}
            >
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      {answered === 0 ? (
        <p className="mt-6 pb-2 text-center text-sm text-slate-400">Nothing to chart yet.</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Questions answered per day over the last ${range} days: ${deflected} of ${answered} resolved automatically.`}
            className="mt-5 flex h-40 items-end gap-px"
          >
            {points.map((p) => {
              const total = Math.round((p.answered / max) * 100)
              const auto = p.answered > 0 ? Math.round((p.deflected / p.answered) * total) : 0
              return (
                <div
                  key={p.day}
                  title={`${formatDay(p.day)}: ${p.deflected} of ${p.answered} resolved automatically`}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                >
                  <div className="w-full rounded-t-sm bg-slate-200" style={{ height: `${total - auto}%` }} />
                  <div className={`w-full bg-emerald-500 ${total === auto && total > 0 ? 'rounded-t-sm' : ''}`} style={{ height: `${auto}%` }} />
                </div>
              )
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[0.6875rem] text-slate-400" aria-hidden="true">
            <span>{formatDay(points[0].day)}</span>
            <span>{formatDay(mid.day)}</span>
            <span>{formatDay(points[points.length - 1].day)}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />Resolved automatically</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" aria-hidden="true" />Handled by a person</span>
          </div>
        </>
      )}
    </section>
  )
}
