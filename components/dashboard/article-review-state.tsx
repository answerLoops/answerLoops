'use client'

import { useActionState, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  clearReviewFlagAction,
  flagArticleForReviewAction,
  restoreArticleAction,
  supersedeArticleAction,
  type ReviewStateActionState,
} from '@/lib/actions/kb'
import { REPLACEMENT_URL_MAX, REVIEW_EFFECT, REVIEW_NOTE_MAX } from '@/lib/kb/review-state'
import type { ArticleReview } from '@/types'

type Mode = 'flag' | 'clear' | 'supersede' | 'restore'

/** An article another one can be replaced by. */
export interface ReplacementOption {
  id: number
  question: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function when(review: ArticleReview): string {
  const date = review.at ? formatDate(review.at) : ''
  return review.by_name ? `${date} by ${review.by_name}` : date
}

/** The state in words; the icon is decoration, so the state is never carried by color alone. */
function StatusLine({ review }: { review: ArticleReview }) {
  if (review.state === 'needs_review') {
    return (
      <p className="min-w-0 break-words text-xs text-amber-700">
        <span aria-hidden="true">⚑ </span>
        Needs review{review.at ? ` (flagged ${when(review)})` : ''}. Still used for answers.
      </p>
    )
  }
  if (review.state === 'superseded') {
    return (
      <div className="min-w-0 space-y-0.5">
        <p className="break-words text-xs font-medium text-slate-700">
          Superseded{review.at ? ` (${when(review)})` : ''}. Not used for answers.
        </p>
        <Replacement review={review} />
      </div>
    )
  }
  return null
}

function Replacement({ review }: { review: ArticleReview }) {
  const r = review.replacement
  if (r?.kind === 'article') {
    return (
      <p className="break-words text-xs text-slate-600">
        Replaced by{' '}
        <a href={`#article-${r.article_id}`} className="text-brand-600 hover:underline">
          {r.question}
        </a>
      </p>
    )
  }
  if (r?.kind === 'url') {
    return (
      <p className="break-all text-xs text-slate-600">
        Replaced by{' '}
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
          {r.url}
        </a>
      </p>
    )
  }
  return <p className="text-xs text-slate-600">Its replacement was deleted. It stays out of answers until restored.</p>
}

/**
 * One confirmation step: says what the action does to customer answers, then
 * runs it. Each step has its own form state, so an error from one never shows
 * on another.
 */
function ConfirmStep({
  action,
  effect,
  submitLabel,
  pendingLabel,
  articleId,
  onDone,
  onCancel,
  children,
}: {
  action: (prev: ReviewStateActionState, formData: FormData) => Promise<ReviewStateActionState>
  effect: string
  submitLabel: string
  pendingLabel: string
  articleId: number
  onDone: () => void
  onCancel: () => void
  children?: React.ReactNode
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: ReviewStateActionState, formData: FormData): Promise<ReviewStateActionState> => {
      const result = await action(prev, formData)
      if (result && 'ok' in result) onDone()
      return result
    },
    null
  )

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="articleId" value={articleId} />
      {children}
      <p className="break-words rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">{effect}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        {state && 'error' in state && (
          <p role="alert" className="min-w-0 break-words text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  )
}

/**
 * The review state of one article and the controls that change it. Any member
 * can flag an article or clear a flag; neither changes what customers are
 * answered. Superseding and restoring do, so those controls show only when
 * `canSupersede` is set (owners and admins; the actions enforce it as well).
 */
export function ArticleReviewStateControl({
  articleId,
  review,
  canSupersede,
  replacementOptions,
  onChanged,
}: {
  articleId: number
  review: ArticleReview
  canSupersede: boolean
  /** Articles this one could be replaced by: published, not superseded, not this one. */
  replacementOptions: ReplacementOption[]
  onChanged?: () => void
}) {
  const [mode, setMode] = useState<Mode | null>(null)
  // Controlled, because React resets an uncontrolled form after every action,
  // including a failed one, which would throw away what the person just typed.
  const [note, setNote] = useState('')
  const [kind, setKind] = useState<'article' | 'url'>(replacementOptions.length > 0 ? 'article' : 'url')
  const [replacementId, setReplacementId] = useState('')
  const [url, setUrl] = useState('')
  const ids = useId()

  function open(next: Mode) {
    // The options can change after a reload, so pick the default replacement
    // kind each time the step opens rather than once on first render.
    if (next === 'supersede') setKind(replacementOptions.length > 0 ? 'article' : 'url')
    setMode(next)
  }

  function close() {
    setMode(null)
    setNote('')
    setReplacementId('')
    setUrl('')
  }

  function done() {
    close()
    onChanged?.()
  }

  const buttons: { mode: Mode; label: string }[] = []
  if (review.state === 'current') buttons.push({ mode: 'flag', label: 'Flag for review' })
  if (review.state === 'needs_review') buttons.push({ mode: 'clear', label: 'Clear review flag' })
  if (canSupersede && review.state !== 'superseded') buttons.push({ mode: 'supersede', label: 'Mark as superseded' })
  if (canSupersede && review.state === 'superseded') buttons.push({ mode: 'restore', label: 'Restore to answers' })

  return (
    <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Full width on phones so the status never shares a row with up to two buttons. */}
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <StatusLine review={review} />
        </div>
        {mode === null &&
          buttons.map((b) => (
            <Button key={b.mode} type="button" size="sm" variant="secondary" onClick={() => open(b.mode)}>
              {b.label}
            </Button>
          ))}
      </div>

      {review.state === 'needs_review' && review.note && (
        <p className="break-words text-xs text-slate-600">
          <span className="font-medium">Reason:</span> {review.note}
        </p>
      )}

      {mode === 'flag' && (
        <ConfirmStep
          action={flagArticleForReviewAction}
          effect={REVIEW_EFFECT.flag}
          submitLabel="Flag for review"
          pendingLabel="Saving…"
          articleId={articleId}
          onDone={done}
          onCancel={close}
        >
          <label htmlFor={`${ids}-note`} className="block text-xs font-medium text-slate-700">
            Reason (optional)
          </label>
          <textarea
            id={`${ids}-note`}
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={REVIEW_NOTE_MAX}
            rows={2}
            placeholder="For example, what looks out of date"
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
          />
        </ConfirmStep>
      )}

      {mode === 'clear' && (
        <ConfirmStep
          action={clearReviewFlagAction}
          effect={REVIEW_EFFECT.clearFlag}
          submitLabel="Clear review flag"
          pendingLabel="Saving…"
          articleId={articleId}
          onDone={done}
          onCancel={close}
        />
      )}

      {mode === 'supersede' && (
        <ConfirmStep
          action={supersedeArticleAction}
          effect={REVIEW_EFFECT.supersede}
          submitLabel="Mark as superseded"
          pendingLabel="Saving…"
          articleId={articleId}
          onDone={done}
          onCancel={close}
        >
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-slate-700">Replaced by</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex items-center gap-2 py-2 text-xs text-slate-700 sm:py-1">
                <input
                  type="radio"
                  name="replacementKind"
                  value="article"
                  checked={kind === 'article'}
                  onChange={() => setKind('article')}
                  disabled={replacementOptions.length === 0}
                  className="h-4 w-4 accent-brand-600"
                />
                Another article
              </label>
              <label className="flex items-center gap-2 py-2 text-xs text-slate-700 sm:py-1">
                <input
                  type="radio"
                  name="replacementKind"
                  value="url"
                  checked={kind === 'url'}
                  onChange={() => setKind('url')}
                  className="h-4 w-4 accent-brand-600"
                />
                A documentation link
              </label>
            </div>
            {kind === 'article' ? (
              <>
                <label htmlFor={`${ids}-article`} className="sr-only">
                  Replacement article
                </label>
                <select
                  id={`${ids}-article`}
                  name="replacementArticleId"
                  value={replacementId}
                  onChange={(e) => setReplacementId(e.target.value)}
                  required
                  className="w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 py-2 text-sm"
                >
                  <option value="" disabled>
                    Choose an article
                  </option>
                  {replacementOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.question.length > 120 ? `${o.question.slice(0, 117)}…` : o.question}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label htmlFor={`${ids}-url`} className="sr-only">
                  Documentation link
                </label>
                <input
                  id={`${ids}-url`}
                  name="replacementUrl"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  maxLength={REPLACEMENT_URL_MAX}
                  placeholder="https://docs.example.com/page"
                  className="w-full min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm"
                />
              </>
            )}
          </fieldset>
        </ConfirmStep>
      )}

      {mode === 'restore' && (
        <ConfirmStep
          action={restoreArticleAction}
          effect={REVIEW_EFFECT.restore}
          submitLabel="Restore to answers"
          pendingLabel="Saving…"
          articleId={articleId}
          onDone={done}
          onCancel={close}
        />
      )}
    </div>
  )
}
