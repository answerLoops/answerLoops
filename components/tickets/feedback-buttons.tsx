'use client'

import { useActionState } from 'react'
import { submitFeedbackAction } from '@/lib/actions/feedback'
import type { FeedbackSummary, FeedbackVote } from '@/types'

interface FeedbackButtonsProps {
  ticketId: number
  summary: FeedbackSummary
}

export function FeedbackButtons({ ticketId, summary }: FeedbackButtonsProps) {
  const [state, formAction, isPending] = useActionState(submitFeedbackAction, null)

  const VoteButton = ({ vote, label }: { vote: FeedbackVote; label: string }) => {
    const active = summary.staffVote === vote
    return (
      <form action={formAction}>
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="vote" value={vote} />
        <button
          type="submit"
          disabled={isPending}
          className={`rounded-md border px-2.5 py-1 text-sm transition-colors disabled:opacity-50 ${
            active
              ? vote === 'up'
                ? 'border-green-300 bg-green-50 text-green-700'
                : 'border-red-300 bg-red-50 text-red-700'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          {label}
        </button>
      </form>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <VoteButton vote="up" label="👍" />
      <VoteButton vote="down" label="👎" />
      <span className="text-xs text-gray-400">
        {summary.up} up · {summary.down} down
        {summary.staffVote && ' · your vote counted'}
      </span>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </div>
  )
}
