'use client'

import { useId, useState } from 'react'
import type { FormEvent } from 'react'

/**
 * The thumbs under one widget answer. A thumbs-down saves a flag at once (so an
 * abandoned panel still counts), then opens a short panel for a reason, a note
 * and, when the workspace allows email follow-up, an optional address. The
 * server only accepts the signed token it handed out for this answer, never the
 * answer's text (see lib/widget/answer-token.ts and app/api/widget/flag).
 *
 * Failures are quiet and local: a failed request shows one short line here and
 * never touches the conversation.
 */

export interface AnswerFeedbackConfig {
  widgetToken: string
  renderToken: string
  /** Whether to ask for an email: false when the owner has switched email follow-up off. */
  offerEmail: boolean
}

const REASONS = [
  { value: 'wrong_information', label: 'Wrong information' },
  { value: 'outdated', label: 'Out of date' },
  { value: 'did_not_answer', label: "Didn't answer my question" },
  { value: 'other', label: 'Something else' },
] as const
type Reason = (typeof REASONS)[number]['value']

const MAX_NOTE_CHARS = 500
const RETRY_MESSAGE = "That didn't send. Please try again."

type Phase = 'idle' | 'panel' | 'thanked' | 'closed' | 'hidden'

async function send(
  method: 'POST' | 'PATCH',
  config: AnswerFeedbackConfig,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch('/api/widget/flag', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widgetToken: config.widgetToken, renderToken: config.renderToken, ...body }),
  })
  let json: Record<string, unknown> | null = null
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = null
  }
  return { status: res.status, json }
}

function Thumb({ down }: { down?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={down ? 'rotate-180' : undefined}
    >
      <path d="M7 10v11H3V10h4Zm0 0 4-7a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21H7" />
    </svg>
  )
}

export function AnswerFeedback({ config, answerToken }: { config: AnswerFeedbackConfig; answerToken: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [flagToken, setFlagToken] = useState('')
  const [reason, setReason] = useState<Reason | null>(null)
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')
  const [thankedWith, setThankedWith] = useState<'up' | 'down'>('up')
  const noteId = useId()
  const emailId = useId()

  async function vote(verdict: 'up' | 'down') {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { status, json } = await send('POST', config, { verdict, answerToken })
      if (status === 403 || status === 404) {
        // The workspace's plan does not include this, or the answer is no
        // longer known to the server: nothing the visitor can do about it.
        setPhase('hidden')
        return
      }
      if (status < 200 || status >= 300) {
        setError(RETRY_MESSAGE)
        return
      }
      if (verdict === 'up') {
        setThankedWith('up')
        setPhase('thanked')
        return
      }
      setFlagToken(typeof json?.flagToken === 'string' ? json.flagToken : '')
      setPhase('panel')
    } catch {
      setError(RETRY_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  async function submitDetails(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const address = email.trim()
    const text = note.trim()
    // Nothing added: the flag is already saved, so this is the same as closing.
    if (!reason && !text && !address) {
      setThankedWith('down')
      setPhase('closed')
      return
    }
    if (!flagToken) {
      // The flag was saved but its token did not come back, so details cannot
      // be attached to it. The thumbs-down itself still counts.
      setThankedWith('down')
      setPhase('closed')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { status } = await send('PATCH', config, {
        flagToken,
        ...(reason ? { reason } : {}),
        ...(text ? { note: text } : {}),
        ...(address && config.offerEmail ? { email: address } : {}),
      })
      if (status === 400 && address) {
        setError("That email address doesn't look right.")
        return
      }
      if (status < 200 || status >= 300) {
        setError(RETRY_MESSAGE)
        return
      }
      setThankedWith('down')
      setPhase('thanked')
    } catch {
      setError(RETRY_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'hidden') return null

  if (phase === 'thanked' || phase === 'closed') {
    return (
      <p className="pl-8 text-[0.6875rem] text-gray-500" data-testid="answer-feedback-thanks" role="status">
        {thankedWith === 'up'
          ? 'Thanks for the feedback.'
          : phase === 'thanked'
            ? 'Thanks. The team will see this.'
            : "Thanks, we've noted it."}
      </p>
    )
  }

  if (phase === 'panel') {
    return (
      <form
        onSubmit={submitDetails}
        className="ml-8 space-y-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2.5"
        data-testid="answer-feedback-panel"
        aria-label="Tell us what went wrong"
      >
        <p className="break-words text-xs text-gray-700">Sorry about that. What went wrong?</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="What went wrong">
          {REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={reason === r.value}
              onClick={() => setReason(reason === r.value ? null : r.value)}
              className={`min-h-9 rounded-full border px-3 py-1.5 text-[0.6875rem] font-medium leading-snug transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                reason === r.value
                  ? 'border-brand-600 bg-brand-600 text-on-brand'
                  : 'border-brand-300 bg-white text-gray-800 hover:bg-brand-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor={noteId} className="block text-[0.6875rem] text-gray-600">
            Anything else we should know? (optional)
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={MAX_NOTE_CHARS}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full resize-none rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          />
        </div>
        {config.offerEmail && (
          <div>
            <label htmlFor={emailId} className="block text-[0.6875rem] text-gray-600">
              Want someone to follow up? Leave your email (optional)
            </label>
            <input
              id={emailId}
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
          </div>
        )}
        {error && (
          <p className="break-words text-[0.6875rem] text-red-500" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-9 rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-medium text-on-brand transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
          >
            Send
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setThankedWith('down')
              setPhase('closed')
            }}
            className="min-h-9 rounded-lg px-2 py-1.5 text-xs text-gray-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
          >
            Not now
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="pl-8" data-testid="answer-feedback">
      <div className="flex items-center gap-1" role="group" aria-label="Was this answer helpful?">
        <span className="mr-1 text-[0.6875rem] text-gray-500">Was this helpful?</span>
        <button
          type="button"
          aria-label="Yes, this answer helped"
          data-testid="feedback-up"
          disabled={busy}
          onClick={() => void vote('up')}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
        >
          <Thumb />
        </button>
        <button
          type="button"
          aria-label="No, this answer was wrong or did not help"
          data-testid="feedback-down"
          disabled={busy}
          onClick={() => void vote('down')}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
        >
          <Thumb down />
        </button>
      </div>
      {error && (
        <p className="break-words text-[0.6875rem] text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
