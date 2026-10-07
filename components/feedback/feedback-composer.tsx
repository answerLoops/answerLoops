'use client'

import { useState, useTransition } from 'react'
import { submitProductFeedbackAction } from '@/lib/actions/product-feedback'
import {
  FEEDBACK_MAX_CHARS,
  FEEDBACK_MIN_CHARS,
  validateFeedbackBody,
} from '@/lib/product-feedback/validation'

export function FeedbackComposer() {
  const [body, setBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, startTransition] = useTransition()

  const length = body.trim().length
  const bodyError = validateFeedbackBody(body)
  const canSubmit = !bodyError && !pending

  function submit() {
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      const result = await submitProductFeedbackAction({ body, anonymous })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setBody('')
      setSent(true)
    })
  }

  return (
    <form
      className="shrink-0 border-t border-slate-200 bg-slate-50/70 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label htmlFor="product-feedback-body" className="sr-only">
        Leave answerLoops some feedback
      </label>
      <textarea
        id="product-feedback-body"
        value={body}
        maxLength={FEEDBACK_MAX_CHARS}
        rows={3}
        onChange={(e) => {
          setBody(e.target.value)
          setSent(false)
        }}
        placeholder="Leave answerLoops some feedback…"
        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 sm:text-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
      />

      <label className="mt-2 flex min-h-9 items-center gap-2 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-slate-300"
        />
        Post anonymously (hides your workspace name)
      </label>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-slate-500" aria-live="polite">
          <span className={length === 0 || bodyError ? 'font-medium text-rose-600' : 'font-medium text-emerald-600'}>
            {length}/{FEEDBACK_MAX_CHARS}
          </span>{' '}
          minimum {FEEDBACK_MIN_CHARS}. No links.
        </p>
        <button
          type="submit"
          disabled={!canSubmit}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {pending ? 'Sending…' : 'Submit'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-rose-600">
          {error}
        </p>
      )}
      {sent && (
        <p role="status" className="mt-2 text-xs font-medium text-emerald-700">
          Thanks! Your feedback is awaiting review and will appear here once approved.
        </p>
      )}
    </form>
  )
}
