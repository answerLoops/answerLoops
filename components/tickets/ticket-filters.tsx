'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { platformLabel, SUPPORTED_PLATFORMS } from '@/lib/tickets/platform-label'

const SELECT = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-slate-300'

export interface TicketFilterValues {
  priority?: string
  category?: string
  platform?: string
  sort?: string
  newActivity?: boolean
}

const OWN_PARAMS = ['priority', 'category', 'platform', 'sort', 'newActivity'] as const

/**
 * The secondary filters for the ticket list. Each change applies straight away
 * by updating the URL, so there is no Filter button. Status lives in the tabs
 * above, and any dashboard card filter or status in the URL is carried along.
 */
export function TicketFilters({ values }: { values: TicketFilterValues }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const update = (name: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(name, value)
    else params.delete(name)
    // A changed filter starts the list over, so an old page cursor no longer applies.
    params.delete('cursor')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const clearParams = new URLSearchParams(searchParams.toString())
  for (const name of OWN_PARAMS) clearParams.delete(name)
  clearParams.delete('cursor')
  const clearQuery = clearParams.toString()
  const active = [values.priority, values.category, values.platform, values.sort, values.newActivity].some(Boolean)

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select aria-label="Filter by priority" value={values.priority ?? ''} onChange={(e) => update('priority', e.target.value || null)} className={SELECT}>
        <option value="">All priorities</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <select aria-label="Filter by category" value={values.category ?? ''} onChange={(e) => update('category', e.target.value || null)} className={SELECT}>
        <option value="">All categories</option>
        <option value="bug">Bug</option>
        <option value="feature_request">Feature Request</option>
        <option value="documentation">Documentation</option>
        <option value="how_to">How-to</option>
        <option value="general_question">General Question</option>
      </select>
      <select aria-label="Filter by channel" value={values.platform ?? ''} onChange={(e) => update('platform', e.target.value || null)} className={SELECT}>
        <option value="">All channels</option>
        {SUPPORTED_PLATFORMS.map((platform) => (
          <option key={platform} value={platform}>{platformLabel(platform)}</option>
        ))}
      </select>
      <select aria-label="Sort tickets" value={values.sort ?? ''} onChange={(e) => update('sort', e.target.value || null)} className={SELECT}>
        <option value="">Newest first</option>
        <option value="activity">Latest activity</option>
      </select>
      <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700">
        <input
          type="checkbox"
          checked={!!values.newActivity}
          onChange={(e) => update('newActivity', e.target.checked ? '1' : null)}
        />
        New activity
      </label>
      {active && (
        <Link href={clearQuery ? `${pathname}?${clearQuery}` : pathname} className="rounded-full px-3 py-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          Clear filters
        </Link>
      )}
    </div>
  )
}
