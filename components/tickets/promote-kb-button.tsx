'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { promoteToKBAction } from '@/lib/actions/kb'
import { Button } from '@/components/ui/button'

interface PromoteKBButtonProps {
  ticketId: number
  /** Set when the ticket is already in the KB (shows a link instead). */
  articleId?: number
  /**
   * Whether the viewer may publish articles (owners and admins). When false the
   * button is replaced by a short note instead of an action that would be
   * refused.
   */
  canPromote?: boolean
}

export function PromoteKBButton({ ticketId, articleId, canPromote = true }: PromoteKBButtonProps) {
  const [state, formAction, isPending] = useActionState(promoteToKBAction, null)

  if (articleId) {
    return (
      <Link href="/kb" className="text-xs font-medium text-green-700 hover:underline">
        ✓ In knowledge base
      </Link>
    )
  }

  if (!canPromote) {
    return <p className="text-xs text-gray-500">Only owners and admins can add this to the knowledge base.</p>
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
        {isPending ? 'Promoting…' : 'Promote to KB'}
      </Button>
      {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  )
}
