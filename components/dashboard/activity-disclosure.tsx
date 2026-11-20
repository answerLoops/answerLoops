'use client'

import { useId, useState, type ReactNode } from 'react'

export function ActivityDisclosure({ headingId, total, viewAll, children }: {
  headingId: string
  total: number
  viewAll: ReactNode
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const previewId = useId()

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3 sm:flex-nowrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-950">
            <button
              type="button"
              aria-label={`Activity, ${total} ${total === 1 ? 'ticket' : 'tickets'} with new customer replies`}
              aria-expanded={expanded}
              aria-controls={previewId}
              onClick={() => setExpanded(!expanded)}
              className="group inline-flex min-h-11 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <span id={headingId}>Activity</span>
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[0.6875rem] font-semibold text-white">
                {total > 99 ? '99+' : total}
              </span>
              <svg aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Customers replied on these tickets. Opening one marks it seen.</p>
        </div>
        {viewAll}
      </div>
      <div id={previewId} hidden={!expanded} className="border-t border-blue-100">
        {children}
      </div>
    </>
  )
}
