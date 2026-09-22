import Link from 'next/link'

export function DeflectionStatusBanner({ offPlatforms }: { offPlatforms: string[] }) {
  if (offPlatforms.length === 0) return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:mb-6">
      <svg className="h-5 w-5 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p className="flex-1">
        {offPlatforms.length} connected integration{offPlatforms.length === 1 ? '' : 's'} set to manual review — high-confidence
        answers wait for your approval before sending: <span className="font-semibold">{offPlatforms.join(', ')}</span>.
      </p>
      <Link
        href="/integrations"
        className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
      >
        Review Integrations
      </Link>
    </div>
  )
}
