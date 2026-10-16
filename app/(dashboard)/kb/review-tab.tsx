'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LockedFeature } from '@/components/billing/locked-feature'
import type { PlanId } from '@/lib/billing/plans'
import type { KBReviewItem, ReviewCounts, ReviewStatus } from '@/lib/db/queries/kb-review'

const STATUS_TABS: { id: ReviewStatus; label: string }[] = [
  { id: 'pending', label: 'To review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
]

const SOURCE_LABEL: Record<KBReviewItem['source'], string> = {
  ticket: 'Support ticket',
  widget: 'Chat widget',
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'locked'; requiredPlan: PlanId }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: KBReviewItem[]; counts: ReviewCounts; full: boolean }

function ReviewCard({
  item,
  onResolved,
}: {
  item: KBReviewItem
  onResolved: () => void
}) {
  const [question, setQuestion] = useState(item.question)
  const [answer, setAnswer] = useState(item.answer)
  const [busy, setBusy] = useState<'approve' | 'reject' | 'reopen' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unanswered = item.answer.trim() === ''

  async function act(action: 'approve' | 'reject' | 'reopen') {
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(`/api/kb/review/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { action, question, answer } : { action }),
      })
      if (res.ok) {
        onResolved()
        return
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Something went wrong. Try again.')
      // Someone else already handled it — drop it from this list.
      if (res.status === 409) onResolved()
    } catch {
      setError('Something went wrong. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const pending = item.status === 'pending'

  return (
    <li className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{SOURCE_LABEL[item.source]}</span>
        {item.source === 'widget' && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500">
            Unverified visitor-supplied text
          </span>
        )}
        {item.occurrences > 1 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">Asked {item.occurrences} times</span>
        )}
        {pending && unanswered && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700">No usable answer — write one</span>
        )}
        <span className="ml-auto text-slate-400">{new Date(item.created_at).toLocaleDateString()}</span>
      </div>

      {pending ? (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor={`review-q-${item.id}`} className="text-xs font-medium text-slate-600">Question</label>
            <input
              id={`review-q-${item.id}`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`review-a-${item.id}`} className="text-xs font-medium text-slate-600">
              Answer <span className="font-normal text-slate-400">— remove any names or account details before approving</span>
            </label>
            <textarea
              id={`review-a-${item.id}`}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={5}
              maxLength={8000}
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => act('approve')}
              disabled={busy !== null || !question.trim() || !answer.trim()}
            >
              {busy === 'approve' ? 'Publishing…' : 'Approve and add to knowledge base'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => act('reject')} disabled={busy !== null}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {item.question && <p className="break-words text-sm font-medium text-slate-900">{item.question}</p>}
          {item.question === '' && item.answer === '' && (
            <p className="text-xs text-slate-400">The text of this item has been removed.</p>
          )}
          {item.answer && <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{item.answer}</p>}
          {item.status === 'approved' ? (
            <p className="text-xs text-emerald-700">Published to the knowledge base.</p>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => act('reopen')} disabled={busy !== null}>
              {busy === 'reopen' ? 'Reopening…' : 'Move back to review'}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>
      )}
    </li>
  )
}

async function fetchQueue(status: ReviewStatus, signal: AbortSignal): Promise<LoadState> {
  try {
    const res = await fetch(`/api/kb/review?status=${status}`, { signal })
    const data = (await res.json().catch(() => ({}))) as {
      items?: KBReviewItem[]
      counts?: ReviewCounts
      full?: boolean
      error?: string
      locked?: boolean
      requiredPlan?: PlanId
    }
    if (res.status === 402 && data.locked) return { kind: 'locked', requiredPlan: data.requiredPlan ?? 'pro' }
    if (res.status === 403) return { kind: 'forbidden' }
    if (!res.ok || !data.items || !data.counts) {
      return { kind: 'error', message: data.error ?? 'Could not load the review queue.' }
    }
    return { kind: 'ready', items: data.items, counts: data.counts, full: data.full === true }
  } catch {
    return { kind: 'error', message: 'Could not load the review queue.' }
  }
}

/**
 * Questions the assistant answered with no knowledge-base coverage. A person
 * fine-tunes each answer and approves it into the KB, or rejects it; nothing
 * here is served to customers before that.
 */
export function ReviewTab({ onCountsChange }: { onCountsChange?: (counts: ReviewCounts) => void }) {
  const [status, setStatus] = useState<ReviewStatus>('pending')
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetchQueue(status, controller.signal).then((next) => {
      if (controller.signal.aborted) return
      setState(next)
      if (next.kind === 'ready') onCountsChange?.(next.counts)
    })
    return () => controller.abort()
  }, [status, reloadKey, onCountsChange])

  if (state.kind === 'locked') {
    return <LockedFeature requiredPlan={state.requiredPlan} featureLabel="The review queue" />
  }

  if (state.kind === 'forbidden') {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        Only workspace owners and admins can review these questions.
      </p>
    )
  }

  const counts = state.kind === 'ready' ? state.counts : null

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        When the assistant gets a question your knowledge base doesn&apos;t cover, it lands here. Tidy the answer, then
        approve it so the next customer gets it from the knowledge base.
      </p>

      <div className="flex min-w-0 gap-1 overflow-x-auto" role="tablist" aria-label="Review status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={status === tab.id}
            onClick={() => {
              if (tab.id === status) return
              setState({ kind: 'loading' })
              setStatus(tab.id)
            }}
            className={[
              'shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
              status === tab.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            ].join(' ')}
          >
            {tab.label}
            {counts && <span className="ml-1.5 tabular-nums opacity-70">{counts[tab.id]}</span>}
          </button>
        ))}
      </div>

      {state.kind === 'ready' && state.full && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The review queue is full, so new questions are not being added. Approve or reject some items to make room.
        </p>
      )}
      {state.kind === 'loading' && <p className="text-sm text-slate-500">Loading…</p>}
      {state.kind === 'error' && (
        <p role="alert" className="text-sm text-red-600">{state.message}</p>
      )}
      {state.kind === 'ready' && state.items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          {status === 'pending' ? 'Nothing to review right now.' : `No ${status} items.`}
        </p>
      )}
      {state.kind === 'ready' && state.items.length > 0 && (
        <ul className="space-y-3">
          {state.items.map((item) => (
            <ReviewCard key={`${item.id}:${item.status}`} item={item} onResolved={() => setReloadKey((k) => k + 1)} />
          ))}
        </ul>
      )}
    </div>
  )
}
