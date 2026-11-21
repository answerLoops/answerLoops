'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { markAllTicketsSeenAction } from '@/lib/actions/notifications'
import { VIEW_ALL_TICKETS_ID } from '@/components/dashboard/activity-ids'

export function ActivityDisclosure({ headingId, total, viewAll, previewNote, snapshot, proof, children }: {
  headingId: string
  total: number
  viewAll: ReactNode
  previewNote?: string
  snapshot?: string
  proof?: string
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const previewId = useId()
  const confirmationId = useId()
  // The confirmation belongs to the proof it was opened for, so a refresh that
  // brings a new proof closes it instead of confirming stale data.
  const [confirmedProof, setConfirmedProof] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'pending' | 'failed'>('idle')
  // `focus` records whether keyboard focus was on the confirmation when it
  // finished, so the result is announced where the user was.
  const [result, setResult] = useState<{ count: number; focus: boolean } | null>(null)
  const submitting = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const confirmationGroup = useRef<HTMLFieldSetElement>(null)
  const output = useRef<HTMLOutputElement>(null)
  const visible = total > 0
  const pending = status === 'pending'
  const error = status === 'failed' && <p role="alert" className="text-sm text-red-700">Couldn’t mark tickets as seen. Try again.</p>

  const confirmation = visible && Boolean(snapshot && proof && confirmedProof === proof)

  const dismissConfirmation = useCallback(() => {
    setConfirmedProof(null)
    setStatus((current) => (current === 'failed' ? 'idle' : current))
  }, [])

  const cancelConfirmation = useCallback(() => {
    dismissConfirmation()
    trigger.current?.focus()
  }, [dismissConfirmation])

  // If a refresh closes the confirmation or the retry fails while focus fell
  // back to the page, put focus somewhere useful.
  useEffect(() => {
    if (document.activeElement !== document.body) return
    const lostConfirmation = confirmedProof !== null && !confirmation
    if (!visible) {
      if (lostConfirmation) document.getElementById(VIEW_ALL_TICKETS_ID)?.focus()
    } else if (status === 'failed') {
      (confirmButton.current ?? trigger.current)?.focus()
    } else if (status === 'idle' && lostConfirmation) {
      trigger.current?.focus()
    }
  }, [confirmation, confirmedProof, status, visible])

  useEffect(() => {
    if (!confirmation || !expanded) return
    cancel.current?.focus()
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || submitting.current) return
      event.preventDefault()
      cancelConfirmation()
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [confirmation, expanded, cancelConfirmation])

  useEffect(() => {
    if (result?.focus) output.current?.focus()
  }, [result])

  function openConfirmation() {
    if (confirmation || submitting.current || !proof) return
    setResult(null)
    setStatus('idle')
    setConfirmedProof(proof)
  }

  async function confirm() {
    if (!confirmation || !snapshot || !proof || submitting.current) return
    submitting.current = true
    setStatus('pending')
    try {
      const response = await markAllTicketsSeenAction(snapshot, proof)
      if (!response.ok) {
        setStatus('failed')
        return
      }
      setResult({
        count: response.count,
        focus: document.activeElement === document.body ||
          Boolean(confirmationGroup.current?.contains(document.activeElement)),
      })
      setConfirmedProof(null)
      setStatus('idle')
    } catch {
      setStatus('failed')
    } finally {
      submitting.current = false
    }
  }

  return (
    <>
      {(visible || pending || result !== null) && (
        <output ref={output} tabIndex={-1} className={result === null ? 'sr-only' : 'block text-sm text-slate-700'}>
          {result !== null && `Marked ${result.count} ${result.count === 1 ? 'ticket' : 'tickets'} as seen.`}
        </output>
      )}
      {(!confirmation || !expanded) && error}
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
                    if (expanded && !submitting.current) dismissConfirmation()
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
            {(previewNote || (snapshot && proof && expanded)) && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 border-t border-blue-100 px-5 py-2">
                {previewNote && <p className="text-xs text-slate-500">{previewNote}</p>}
                {snapshot && proof && expanded && (
                  <button
                    ref={trigger}
                    type="button"
                    disabled={pending}
                    aria-expanded={confirmation}
                    aria-controls={confirmation ? confirmationId : undefined}
                    onClick={openConfirmation}
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
                  Mark {total} {total === 1 ? 'ticket' : 'tickets'} as seen?
                </legend>
                <p id={`${confirmationId}-details`} className="clear-both text-sm text-slate-700">
                  This clears new activity and unread customer-reply notifications for these tickets for your whole team. Ticket statuses stay the same. This cannot be undone.
                </p>
                {error}
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button
                    ref={cancel}
                    type="button"
                    disabled={pending}
                    onClick={cancelConfirmation}
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
