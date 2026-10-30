'use client'

import { useEffect } from 'react'
import { markTicketSeenAction } from '@/lib/actions/notifications'

/**
 * Opening a ticket is what marks it seen: its notifications turn read and its
 * "new activity" badge goes away. Renders nothing.
 */
export function MarkTicketSeen({ ticketNumber }: { ticketNumber: number }) {
  useEffect(() => {
    void markTicketSeenAction(ticketNumber)
  }, [ticketNumber])
  return null
}
