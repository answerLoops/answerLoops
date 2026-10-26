'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ANSWER_REFERENCE_RETENTION_DAYS } from '@/lib/kb/coverage'
import { OUTCOME_LABEL, SURFACE_LABEL } from '@/lib/kb/answer-labels'
import type { KBArticleAnswerView } from '@/types'

type Load =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; answers: KBArticleAnswerView[] }

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * The recent answers one article was supplied to as context: where, when, the
 * outcome, and whether the article has changed since. It loads the first time
 * it is opened, so the article list stays fast. Owners and admins only; the
 * caller decides whether to show it and the route enforces it. No question or
 * answer text is stored, so none is shown.
 */
export function ArticleAnswers({ articleId }: { articleId: number }) {
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState<Load>({ status: 'idle' })
  const panelId = useId()
  const controller = useRef<AbortController | null>(null)

  const fetchAnswers = useCallback(async () => {
    controller.current?.abort()
    const ctl = new AbortController()
    controller.current = ctl
    setLoad({ status: 'loading' })
    try {
      const res = await fetch(`/api/kb/articles/${articleId}/answers`, { signal: ctl.signal })
      if (res.status === 403 || res.status === 401) {
        setLoad({ status: 'error', message: 'Only owners and admins can see which answers an article was supplied to.' })
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { answers: KBArticleAnswerView[] }
      setLoad({ status: 'ready', answers: body.answers })
    } catch {
      if (ctl.signal.aborted) return
      setLoad({ status: 'error', message: 'Could not load the answers.' })
    }
  }, [articleId])

  useEffect(() => () => controller.current?.abort(), [])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && load.status === 'idle') void fetchAnswers()
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-xs text-brand-600 hover:underline"
      >
        {open ? 'Hide recent answers' : 'Show recent answers'}
      </button>

      {open && (
        <div id={panelId} className="mt-2 border-l-2 border-gray-200 pl-3">
          <p className="mb-2 text-xs text-slate-600">
            Answers this article was supplied to as context. The assistant decides what to use, so this does not mean the
            reply quoted it.
          </p>

          {load.status === 'loading' && (
            <p role="status" className="text-xs text-slate-500">
              Loading answers…
            </p>
          )}

          {load.status === 'error' && (
            <p role="alert" className="text-xs text-red-600">
              {load.message}{' '}
              {load.message === 'Could not load the answers.' && (
                <button type="button" onClick={() => void fetchAnswers()} className="underline">
                  Try again
                </button>
              )}
            </p>
          )}

          {load.status === 'ready' && load.answers.length === 0 && (
            <p className="text-xs text-slate-500">
              Not supplied to any answer in the last {ANSWER_REFERENCE_RETENTION_DAYS} days.
            </p>
          )}

          {load.status === 'ready' && load.answers.length > 0 && (
            <ol className="space-y-3">
              {load.answers.map((a) => (
                <li key={`${a.answer_id}`} className="min-w-0 text-xs">
                  <p className="break-words font-medium text-gray-900">{SURFACE_LABEL[a.surface]}</p>
                  <p className="break-words text-slate-600">
                    <time dateTime={a.created_at}>{formatWhen(a.created_at)}</time>
                    {' · '}
                    {OUTCOME_LABEL[a.outcome]}
                    {' · '}
                    Position {a.rank}
                  </p>
                  {a.revision === 'earlier' && (
                    <p className="break-words text-amber-700">
                      <span aria-hidden="true">! </span>
                      The article has changed since this answer.
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
