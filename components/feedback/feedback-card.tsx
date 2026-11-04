'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { toggleProductFeedbackVoteAction } from '@/lib/actions/product-feedback'
import { formatBoardDate } from '@/lib/product-feedback/dates'
import { REPLY_TAG_LABELS, type BoardFeedback } from '@/lib/product-feedback/validation'
import { LogoMark } from '@/components/logo'
import { ArrowUpIcon, ChatIcon, ThumbIcon } from './feedback-icons'

const STATUS_NOTE: Record<BoardFeedback['status'], string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Not approved',
}

type VoteView = { voteCount: number; viewerVoted: boolean }

const sameView = (a: VoteView, b: VoteView) => a.voteCount === b.voteCount && a.viewerVoted === b.viewerVoted

/**
 * The up arrow with its count. Three layers of truth, newest wins: the
 * optimistic flip while the click is in flight, the server's answer once it
 * lands, and the snapshot prop once the live refetch catches up. The confirmed
 * answer is remembered together with the prop it was computed from, so the
 * moment the prop moves (the refetch arrived) it is dropped — no effect, no
 * flicker back to the stale count in between.
 */
function VoteButton({ item }: { item: BoardFeedback }) {
  const server: VoteView = { voteCount: item.voteCount, viewerVoted: item.viewerVoted }
  const [confirmed, setConfirmed] = useState<{ from: VoteView; view: VoteView } | null>(null)
  const base = confirmed && sameView(confirmed.from, server) ? confirmed.view : server
  const [view, setOptimistic] = useOptimistic(base, (cur: VoteView, next: boolean): VoteView =>
    next === cur.viewerVoted ? cur : { viewerVoted: next, voteCount: Math.max(0, cur.voteCount + (next ? 1 : -1)) },
  )
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggle() {
    if (pending) return
    setError(null)
    const next = !view.viewerVoted
    startTransition(async () => {
      setOptimistic(next)
      // Only the entry id travels; the server decides who is voting.
      const result = await toggleProductFeedbackVoteAction({ feedbackId: item.id })
      if (!result.ok) {
        // The optimistic layer falls away with the transition; say why.
        setError(result.error)
        return
      }
      const added = result.state === 'added'
      setConfirmed({
        from: server,
        view: { viewerVoted: added, voteCount: Math.max(0, base.voteCount + (added === base.viewerVoted ? 0 : added ? 1 : -1)) },
      })
    })
  }

  const noun = view.voteCount === 1 ? 'vote' : 'votes'
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={view.viewerVoted}
        aria-label={`${view.viewerVoted ? 'Remove your upvote' : 'Upvote'}, ${view.voteCount} ${noun}`}
        className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-semibold tabular-nums transition ${
          view.viewerVoted
            ? 'border-[#168fa3] bg-[#168fa3]/10 text-[#0e7c8f]'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
        } disabled:opacity-70`}
      >
        <ArrowUpIcon className="h-3.5 w-3.5" />
        <span>{view.voteCount}</span>
      </button>
      {error && (
        <output className="max-w-40 text-right text-xs leading-snug text-amber-700">{error}</output>
      )}
    </div>
  )
}

export function FeedbackCard({ item }: { item: BoardFeedback }) {
  const stamp =
    item.status === 'approved' && item.approvedAt
      ? `Approved ${formatBoardDate(item.approvedAt)}`
      : `${STATUS_NOTE[item.status]} · ${formatBoardDate(item.createdAt)}`
  // Votes exist only on approved entries. Someone else's entry gets the arrow;
  // the author sees their own count but cannot vote for themselves.
  const approved = item.status === 'approved'

  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
            <ChatIcon />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{item.authorLabel}</p>
            <p className="text-xs text-slate-500">{stamp}</p>
          </div>
          {approved && !item.mine && <VoteButton item={item} />}
          {approved && item.mine && (
            <span
              aria-label={`${item.voteCount} ${item.voteCount === 1 ? 'upvote' : 'upvotes'}`}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-semibold tabular-nums text-slate-500"
            >
              <ArrowUpIcon className="h-3.5 w-3.5" />
              <span>{item.voteCount}</span>
            </span>
          )}
        </div>

        <p className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{item.body}</p>

        {(item.mine || item.status !== 'approved') && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {item.mine && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                You
              </span>
            )}
            {item.status !== 'approved' && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                {STATUS_NOTE[item.status]}
              </span>
            )}
          </div>
        )}
      </div>

      {item.reply && (
        <div className="border-t border-slate-200 bg-slate-50 py-3.5 pl-7 pr-3.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-l-2 border-indigo-200 pl-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
              <LogoMark size={18} />
            </div>
            <p className="min-w-0 text-sm font-semibold text-slate-900">Nathan @ answerLoops</p>
            {item.reply.tag && (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                <ThumbIcon className="h-3 w-3" />
                {REPLY_TAG_LABELS[item.reply.tag]}
              </span>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-indigo-200 pl-3 text-sm leading-relaxed text-slate-700">
            {item.reply.body}
          </p>
        </div>
      )}
    </li>
  )
}
