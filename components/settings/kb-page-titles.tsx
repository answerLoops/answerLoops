'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { retitleStatusAction, runRetitleAction } from '@/lib/actions/kb-retitle'

/**
 * "Update imported page titles" (Settings → AI Model). Sections from pages
 * imported before titles carried the page are titled by their heading alone.
 * Workspaces on the platform embedding model are updated in the background;
 * one on its own embedding key, or a self-hosted install, runs the update
 * here, on its own key. Shown only when it applies and pages are waiting.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'idle'; remaining: number; error?: string }
  | { kind: 'running'; remaining: number }
  | { kind: 'done' }

export function KbPageTitlesSection() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    retitleStatusAction()
      .then((s) => {
        if (cancelled) return
        setState(s.eligibleForOwnerRun && s.remainingSources > 0 ? { kind: 'idle', remaining: s.remainingSources } : { kind: 'hidden' })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'hidden' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function update(remaining: number) {
    let left = remaining
    setState({ kind: 'running', remaining: left })
    // Each call handles a few pages; keep going until none are left or one fails.
    for (;;) {
      let result: Awaited<ReturnType<typeof runRetitleAction>>
      try {
        result = await runRetitleAction()
      } catch {
        setState({ kind: 'idle', remaining: left, error: 'The update could not be reached. Try again.' })
        return
      }
      if (!result.ok) {
        setState({ kind: 'idle', remaining: left, error: result.error })
        return
      }
      left = result.remainingSources
      if (left === 0) {
        setState({ kind: 'done' })
        return
      }
      setState({ kind: 'running', remaining: left })
    }
  }

  if (state.kind === 'loading' || state.kind === 'hidden') return null

  // One live region, present from the first render, whose text changes, so a
  // screen reader announces each step once.
  const status =
    state.kind === 'running'
      ? `Updating… ${state.remaining} page${state.remaining === 1 ? '' : 's'} left. Keep this page open until it finishes.`
      : state.kind === 'done'
        ? 'Titles updated.'
        : ''

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
      <p className="text-sm font-medium text-gray-900">Update imported page titles</p>
      <p className="mt-0.5 text-xs text-gray-500">
        Sections from pages you imported earlier are titled by their heading alone. Updating adds the page to each title, which
        helps the widget find them. This re-processes those sections with your embedding key.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {state.kind !== 'done' && (
          <Button size="sm" variant="secondary" disabled={state.kind === 'running'} onClick={() => update(state.remaining)}>
            Update titles
          </Button>
        )}
        <output className={`min-w-0 break-words text-xs ${state.kind === 'done' ? 'text-sm text-emerald-700' : 'text-gray-500'}`}>
          {status}
        </output>
        {state.kind === 'idle' && state.error && (
          <p className="min-w-0 break-words text-xs text-red-600" role="alert">{state.error}</p>
        )}
      </div>
    </div>
  )
}
