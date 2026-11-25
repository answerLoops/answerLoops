'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/**
 * The ticket's less common actions, behind a "⋯" button so a destructive one is
 * never a bare link in the header. Today that is Delete, which asks once more
 * before it does anything.
 */
export function TicketActionsMenu({ ticketId }: { ticketId: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setConfirming(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) close() }
    const onDown = (e: MouseEvent) => { if (!pending && root.current && !root.current.contains(e.target as Node)) close() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, pending])

  async function handleDelete() {
    setPending(true)
    await fetch(`/api/tickets/${ticketId}`, { method: 'DELETE' })
    router.push('/tickets')
    router.refresh()
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Ticket actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {confirming ? (
            <div className="space-y-2 p-2">
              <p className="text-sm text-slate-700">Delete this ticket?</p>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" onClick={handleDelete} disabled={pending}>
                  {pending ? 'Deleting…' : 'Yes, delete'}
                </Button>
                <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirming(true)}
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              Delete ticket…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
