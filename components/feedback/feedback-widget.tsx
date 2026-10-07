'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeLiveEvents } from '@/lib/live-events'
import type { BoardSnapshot } from '@/lib/product-feedback/validation'
import { LogoMark } from '@/components/logo'
import { FeedbackCard } from './feedback-card'
import { FeedbackComposer } from './feedback-composer'
import { UpdatesTab } from './updates-tab'
import { CloseIcon } from './feedback-icons'
import { useVisualViewport } from './use-visual-viewport'

const DEBOUNCE_MS = 300
const SEEN_KEY = 'answerloops:feedback:last-seen-update'

// Per-browser convenience only: losing it just shows the dot again. Every
// access is guarded because storage can be blocked or throw (private windows).
function readSeenUpdateId(): number {
  try {
    const n = Number(window.localStorage.getItem(SEEN_KEY))
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function writeSeenUpdateId(id: number) {
  try {
    window.localStorage.setItem(SEEN_KEY, String(id))
  } catch {
    // ignore
  }
}

type Tab = 'feedback' | 'updates'

/**
 * Floating product-feedback board, mounted once in the dashboard layout so it
 * appears in every workspace. Collapsed it is a pill showing the logo and a
 * live count of approved feedback; expanded it is a panel with a Feedback tab
 * (board + composer) and an Updates tab (operator-posted release notes).
 *
 * Data is a per-viewer snapshot from `/api/product-feedback`. It is refetched
 * on the shared live stream's `feedback_changed` (and `resync`, which means the
 * stream was rebuilt and events may have been missed), so the count and board
 * update without a page refresh. The snapshot is fetched even while collapsed —
 * that is what keeps the pill's count live.
 */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('feedback')
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const pillRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  // Listeners only run while the panel is open; the pill needs none.
  const viewport = useVisualViewport(open)
  // null until storage has been read, so the dot never flashes on first paint.
  const [seenUpdateId, setSeenUpdateId] = useState<number | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/product-feedback', { cache: 'no-store', signal })
      if (!res.ok) return
      setSnapshot((await res.json()) as BoardSnapshot)
    } catch {
      // Network blip or abort: keep showing the last snapshot. The next live
      // event or resync tries again.
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let debounce: ReturnType<typeof setTimeout> | undefined
    void load(controller.signal)

    const unsubscribe = subscribeLiveEvents(['feedback_changed', 'resync'], (event) => {
      clearTimeout(debounce)
      if (event === 'resync') {
        void load()
        return
      }
      debounce = setTimeout(() => void load(), DEBOUNCE_MS)
    })

    return () => {
      controller.abort()
      clearTimeout(debounce)
      unsubscribe()
    }
  }, [load])

  useEffect(() => {
    setSeenUpdateId(readSeenUpdateId())
  }, [])

  const newestUpdateId = snapshot?.updates.reduce((max, u) => Math.max(max, u.id), 0) ?? 0

  // Viewing the Updates tab marks everything posted so far as seen — including
  // an update that arrives live while the tab is already open.
  useEffect(() => {
    if (open && tab === 'updates' && newestUpdateId > 0) {
      writeSeenUpdateId(newestUpdateId)
      setSeenUpdateId(newestUpdateId)
    }
  }, [open, tab, newestUpdateId])

  const hasNewUpdate = seenUpdateId !== null && newestUpdateId > seenUpdateId

  useEffect(() => {
    if (open) {
      closeRef.current?.focus()
    } else if (wasOpen.current) {
      pillRef.current?.focus()
    }
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const count = snapshot?.approvedCount ?? 0
  const updatesCount = snapshot?.updates.length ?? 0

  if (!open) {
    return (
      <button
        ref={pillRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open product feedback, ${count} ${count === 1 ? 'entry' : 'entries'}${hasNewUpdate ? ', new update' : ''}`}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white py-1.5 pl-1.5 pr-2 shadow-lg shadow-slate-900/10 transition hover:border-blue-300 hover:shadow-xl"
      >
        <span
          aria-live="polite"
          className="flex h-9 min-w-9 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 px-2 text-sm font-semibold tabular-nums text-blue-700"
        >
          {count}
        </span>
        <span className="text-sm font-semibold text-slate-900">Feedback</span>
        <span className="h-7 w-px bg-slate-200" aria-hidden />
        <span className="relative flex h-8 w-8 items-center justify-center">
          <LogoMark size={24} />
          {hasNewUpdate && (
            <span
              data-testid="new-update-dot"
              className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-[#168fa3] ring-2 ring-white"
            />
          )}
        </span>
      </button>
    )
  }

  return (
    <section
      role="dialog"
      aria-label="Product feedback"
      style={
        viewport
          ? {
              maxHeight: `min(42rem, 100dvh - 2rem, ${Math.max(0, viewport.height - 32)}px)`,
              bottom: `calc(max(1rem, env(safe-area-inset-bottom)) + ${viewport.bottomInset}px)`,
            }
          : undefined
      }
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-50 flex max-h-[min(42rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 sm:w-[26rem]"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-300/15 bg-blue-400/10">
          <LogoMark size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">Product Feedback</h2>
          <p className="text-xs text-slate-500">
            answer<span className="text-[#168fa3]">Loops</span>
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse feedback"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 sm:h-8 sm:w-8 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <CloseIcon />
        </button>
      </header>

      <div role="tablist" aria-label="Feedback sections" className="grid shrink-0 grid-cols-2 border-b border-slate-200">
        {(
          [
            ['feedback', 'Feedback', count],
            ['updates', 'Updates', updatesCount],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            role="tab"
            id={`feedback-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`feedback-panel-${id}`}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center justify-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
              tab === id
                ? 'border-[#168fa3] text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
            {id === 'updates' && hasNewUpdate && (
              <span data-testid="new-update-tab-dot" className="h-2 w-2 rounded-full bg-[#168fa3]" />
            )}
            <span className="rounded-full border border-blue-100 bg-blue-50 px-2 text-xs font-semibold tabular-nums text-blue-700">
              {n}
            </span>
          </button>
        ))}
      </div>

      {tab === 'feedback' ? (
        <>
          <div
            role="tabpanel"
            id="feedback-panel-feedback"
            aria-labelledby="feedback-tab-feedback"
            className="min-h-24 flex-1 overflow-y-auto bg-slate-50/50 p-3"
          >
            {!snapshot ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
            ) : snapshot.feedback.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                No feedback yet. Be the first to tell us what you think.
              </p>
            ) : (
              <ul className="space-y-3">
                {snapshot.feedback.map((item) => (
                  <FeedbackCard key={item.id} item={item} />
                ))}
              </ul>
            )}
          </div>
          <FeedbackComposer />
        </>
      ) : (
        <div
          role="tabpanel"
          id="feedback-panel-updates"
          aria-labelledby="feedback-tab-updates"
          className="min-h-24 flex-1 overflow-y-auto bg-slate-50/50"
        >
          <UpdatesTab updates={snapshot?.updates ?? []} />
        </div>
      )}
    </section>
  )
}
