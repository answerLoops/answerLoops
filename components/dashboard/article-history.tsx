'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { describeHistoryEntry } from '@/lib/kb/history-labels'
import type { KBArticleHistoryEntry } from '@/types'

type Load =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: KBArticleHistoryEntry[] }

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * The history of one article: what happened to it, who did it, when, and where
 * it came from, newest first. It loads the first time the row is opened, so the
 * article list stays fast. Imports and syncs are shown as what they are, never
 * as a person, and an article from before history was recorded says so.
 */
export function ArticleHistory({ articleId }: { articleId: number }) {
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState<Load>({ status: 'idle' })
  const panelId = useId()
  const controller = useRef<AbortController | null>(null)

  const fetchHistory = useCallback(async () => {
    controller.current?.abort()
    const ctl = new AbortController()
    controller.current = ctl
    setLoad({ status: 'loading' })
    try {
      const res = await fetch(`/api/kb/articles/${articleId}/history`, { signal: ctl.signal })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { events: KBArticleHistoryEntry[] }
      setLoad({ status: 'ready', entries: body.events })
    } catch (err) {
      if (ctl.signal.aborted) return
      setLoad({ status: 'error' })
    }
  }, [articleId])

  useEffect(() => () => controller.current?.abort(), [])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && load.status === 'idle') void fetchHistory()
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-xs text-brand-600 hover:underline"
      >
        {open ? 'Hide history' : 'Show history'}
      </button>

      {open && (
        <div id={panelId} className="mt-2 border-l-2 border-gray-200 pl-3">
          {load.status === 'loading' && (
            <p role="status" className="text-xs text-slate-500">
              Loading history…
            </p>
          )}

          {load.status === 'error' && (
            <p role="alert" className="text-xs text-red-600">
              Could not load the history.{' '}
              <button type="button" onClick={() => void fetchHistory()} className="underline">
                Try again
              </button>
            </p>
          )}

          {load.status === 'ready' && load.entries.length === 0 && (
            <p className="text-xs text-slate-500">No history recorded before this was introduced.</p>
          )}

          {load.status === 'ready' && load.entries.length > 0 && (
            <ol className="space-y-3">
              {load.entries.map((entry) => {
                const labels = describeHistoryEntry(entry)
                return (
                  <li key={entry.id} className="min-w-0 text-xs">
                    <p className="break-words font-medium text-gray-900">{labels.title}</p>
                    <p className="break-words text-slate-600">
                      {labels.actor}
                      {' · '}
                      <time dateTime={entry.created_at}>{formatWhen(entry.created_at)}</time>
                      {/* "Imported" and "Synced" already say where it came from. */}
                      {!labels.automated && ` · ${labels.origin}`}
                    </p>
                    {entry.source_ticket_number != null && (
                      <Link href={`/tickets/${entry.source_ticket_number}`} className="text-brand-600 hover:underline">
                        Ticket #{entry.source_ticket_number} →
                      </Link>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
