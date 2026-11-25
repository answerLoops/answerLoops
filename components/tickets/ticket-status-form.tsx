'use client'

import { useActionState, useId } from 'react'
import { updateTicketStatusAction } from '@/lib/actions/tickets'
import { Button } from '@/components/ui/button'
import type { TicketStatus } from '@/types'

export function TicketStatusForm({ ticketId, currentStatus }: { ticketId: number; currentStatus: TicketStatus }) {
  const [state, formAction, isPending] = useActionState(updateTicketStatusAction, null)
  const id = useId()

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <div>
        <label htmlFor={`${id}-status`} className="block text-xs font-medium text-gray-600 mb-1">Status</label>
        <select id={`${id}-status`} name="status" defaultValue={currentStatus} className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm">
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
          <option value="duplicate">Duplicate</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-notes`} className="block text-xs font-medium text-gray-600 mb-1">Resolution notes (optional)</label>
        <textarea id={`${id}-notes`} name="resolutionNotes" rows={2} placeholder="What was done to resolve this?"
          className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm resize-none" />
      </div>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? 'Saving…' : 'Update status'}
      </Button>
    </form>
  )
}
