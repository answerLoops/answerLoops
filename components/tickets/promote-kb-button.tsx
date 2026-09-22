'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { promoteToKBAction } from '@/lib/actions/kb'
import { Button } from '@/components/ui/button'

interface PromoteKBButtonProps {
  ticketId: number
  /** Set when the ticket is already in the KB (shows a link instead). */
  articleId?: number
}

export function PromoteKBButton({ ticketId, articleId }: PromoteKBButtonProps) {
  const [state, formAction, isPending] = useActionState(promoteToKBAction, null)

  if (articleId) {
    return (
      <Link href="/kb" className="text-xs font-medium text-green-700 hover:underline">
        ✓ In knowledge base
      </Link>
    )
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
