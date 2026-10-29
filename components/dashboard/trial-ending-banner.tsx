import Link from 'next/link'

/**
 * Warns that the free trial is about to end, with one button straight to
 * checkout. Shown for the last three days; the layout decides whether it
 * applies. Carries the number of days left, never a date, so it reads the same
 * in every timezone.
 */
export function TrialEndingBanner({ daysLeft }: { daysLeft: number }) {
  const lastDay = daysLeft <= 1
  const message = lastDay
    ? 'Your free trial ends within a day. Choose a plan to keep answers going.'
    : `Your free trial ends in ${daysLeft} days. Choose a plan to keep answers going.`
  const tone = lastDay ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
  const icon = lastDay ? 'text-red-500' : 'text-amber-500'
  const button = lastDay ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'

  return (
    <div
      role={lastDay ? 'alert' : 'status'}
      className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm sm:mb-6 ${tone}`}
    >
      <svg className={`h-5 w-5 shrink-0 ${icon}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <p className="min-w-0 flex-1">
        {message} <span className="opacity-80">No card is on file and nothing is charged until you subscribe.</span>
      </p>
      <Link
        href="/checkout"
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${button}`}
      >
        Choose a plan
      </Link>
    </div>
  )
}
