'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { markAllTicketsSeenAction } from '@/lib/actions/notifications'

export function ActivityDisclosure({ headingId, total, viewAll, previewNote, cutoff, proof, children }: {
  headingId: string
  total: number
  viewAll: ReactNode
  previewNote?: string
  cutoff?: string
  proof?: string
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const previewId = useId()
  const confirmationId = useId()
  const [confirmation, setConfirmation] = useState<{ cutoff: string; proof: string; total: number } | null>(null)
  const [pending, setPending] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const submitting = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const confirmationGroup = useRef<HTMLFieldSetElement>(null)
  const status = useRef<HTMLOutputElement>(null)
  const visible = total > 0
  const error = failed && <p role="alert" className="text-sm text-red-700">Couldn’t mark tickets as seen. Try again.</p>

  if (!visible && confirmation) setConfirmation(null)

  useEffect(() => {
    if (!confirmation || !expanded || !visible) return
    cancel.current?.focus()
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || submitting.current) return
      event.preventDefault()
      setConfirmation(null)
      setFailed(false)
      trigger.current?.focus()
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [confirmation, expanded, visible])

  useEffect(() => {
    if (failed && !pending && document.activeElement === document.body) confirmButton.current?.focus()
  }, [failed, pending])

  async function confirm() {
    if (!confirmation || submitting.current) return
    submitting.current = true
    setPending(true)
    setFailed(false)
    try {
      const result = await markAllTicketsSeenAction(confirmation.cutoff, confirmation.proof)
      if (!result.ok) {
        setFailed(true)
        return
      }
      setCount(result.count)
      setConfirmation(null)
      if (document.activeElement === document.body || confirmationGroup.current?.contains(document.activeElement)) {
        status.current?.focus()
      }
    } catch {
      setFailed(true)
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <>
      {(visible || confirmation || pending || count !== null) && (
        <output ref={status} tabIndex={-1} className={count === null ? 'sr-only' : 'block text-sm text-slate-700'}>
          {count !== null && `Marked ${count} ${count === 1 ? 'ticket' : 'tickets'} as seen.`}
        </output>
      )}
      {(!confirmation || !expanded || !visible) && error}
      {total > 0 && (
        <section
          aria-labelledby={headingId}
          className="overflow-hidden rounded-2xl border border-blue-200 bg-blue-50/50 shadow-[0_16px_45px_rgba(30,64,175,0.06)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3 sm:flex-nowrap">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-950">
                <button
                  type="button"
                  aria-label={`Activity, ${total} ${total === 1 ? 'ticket' : 'tickets'} with new customer replies`}
                  aria-expanded={expanded}
                  aria-controls={previewId}
                  onClick={() => {
                    setExpanded(!expanded)
                    if (expanded && !submitting.current) {
                      setConfirmation(null)
                      setFailed(false)
                    }
                  }}
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
            {(previewNote || (cutoff && proof && expanded)) && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 border-t border-blue-100 px-5 py-2">
                {previewNote && <p className="text-xs text-slate-500">{previewNote}</p>}
                {cutoff && proof && expanded && (
                  <button
                    ref={trigger}
                    type="button"
                    disabled={pending}
                    aria-expanded={confirmation !== null}
                    aria-controls={confirmation ? confirmationId : undefined}
                    onClick={() => {
                      if (confirmation || submitting.current) return
                      setCount(null)
                      setFailed(false)
                      setConfirmation({ cutoff, proof, total })
                    }}
                    className="ml-auto min-h-11 rounded-md px-2 text-sm font-medium text-slate-700 hover:bg-blue-100"
                  >
                    Mark all as seen
                  </button>
                )}
              </div>
            )}
            {confirmation && (
              <fieldset ref={confirmationGroup} id={confirmationId} aria-describedby={`${confirmationId}-details`} className="min-w-0 border-t border-blue-100 px-5 py-3">
                <legend className="float-left mb-1 w-full text-sm font-semibold text-slate-950">
                  Mark {confirmation.total} {confirmation.total === 1 ? 'ticket' : 'tickets'} as seen?
                </legend>
                <p id={`${confirmationId}-details`} className="clear-both text-sm text-slate-700">
                  This clears their new activity and unread notifications for your whole team. No tickets are deleted or closed. This cannot be undone.
                </p>
                {error}
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button
                    ref={cancel}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setConfirmation(null)
                      setFailed(false)
                      trigger.current?.focus()
                    }}
                    className="min-h-11 rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-blue-100 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    ref={confirmButton}
                    type="button"
                    disabled={pending}
                    onClick={confirm}
                    className="min-h-11 rounded-md bg-blue-700 px-3 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                  >
                    {pending ? 'Marking tickets…' : 'Confirm mark all as seen'}
                  </button>
                </div>
              </fieldset>
            )}
          </div>
        </section>
      )}
    </>
  )
}
