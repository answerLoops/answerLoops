'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LockedFeature } from '@/components/billing/locked-feature'
import type { PlanId } from '@/lib/billing/plans'
import type { AnswerFlag, FlagCounts, FlagReason, FlagStatus } from '@/lib/db/queries/widget-answer-flags'
import { groupFlagsByArticle } from '@/lib/widget/flag-groups'

const STATUS_TABS: { id: FlagStatus; label: string }[] = [
  { id: 'open', label: 'To review' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Dismissed' },
]

const REASON_LABEL: Record<FlagReason, string> = {
  wrong_information: 'Wrong information',
  outdated: 'Out of date',
  did_not_answer: "Didn't answer the question",
  other: 'Something else',
}

type Action = 'resolve' | 'dismiss' | 'reopen'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'locked'; requiredPlan: PlanId }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: AnswerFlag[]; counts: FlagCounts }

function FlagCard({ flag, onChanged }: { flag: AnswerFlag; onChanged: () => void }) {
  const [busy, setBusy] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(action: Action) {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(`/api/kb/flags/${flag.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        onChanged()
        return
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Something went wrong. Try again.')
      // Someone else already handled it: show what it is now.
      if (res.status === 409) onChanged()
    } catch {
      setError('Something went wrong. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const textRemoved = flag.question === '' && flag.answer === ''

  return (
    <li className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" data-testid="flag-card">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {flag.reason && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">{REASON_LABEL[flag.reason]}</span>
        )}
        {flag.lead_id != null && (
          <Link
            href="/leads"
            className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700 hover:bg-blue-200"
          >
            Left an email for a follow-up
          </Link>
        )}
        <span className="ml-auto text-slate-400">{new Date(flag.created_at).toLocaleDateString()}</span>
      </div>

      {textRemoved ? (
        <p className="mt-3 text-xs text-slate-400">The text of this flag is no longer stored.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {flag.question && (
            <div>
              <p className="text-xs font-medium text-slate-500">Visitor asked</p>
              <p className="mt-0.5 break-words text-sm font-medium text-slate-900">{flag.question}</p>
            </div>
          )}
          {flag.answer && (
            <div>
              <p className="text-xs font-medium text-slate-500">The widget answered</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-600">{flag.answer}</p>
            </div>
          )}
        </div>
      )}

      {flag.note && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs font-medium text-slate-500">Visitor&apos;s note (unverified)</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">{flag.note}</p>
        </div>
      )}

      {flag.cited_articles.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Cited:{' '}
          {flag.cited_articles.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ', '}
              <Link href={`/kb#article-${a.id}`} className="font-medium text-blue-700 hover:underline">
                {a.question}
              </Link>
            </span>
          ))}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {flag.status === 'open' && (
          <>
            <Button size="sm" onClick={() => act('resolve')} disabled={busy !== null}>
              {busy === 'resolve' ? 'Resolving…' : 'Mark resolved'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => act('dismiss')} disabled={busy !== null}>
              {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
            </Button>
          </>
        )}
        {flag.status === 'resolved' && (
          <>
            <Button size="sm" variant="secondary" onClick={() => act('reopen')} disabled={busy !== null}>
              {busy === 'reopen' ? 'Reopening…' : 'Move back to review'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => act('dismiss')} disabled={busy !== null}>
              {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
            </Button>
          </>
        )}
        {flag.status === 'dismissed' && (
          <Button size="sm" variant="secondary" onClick={() => act('reopen')} disabled={busy !== null}>
            {busy === 'reopen' ? 'Reopening…' : 'Move back to review'}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {error}
        </p>
      )}
    </li>
  )
}

async function fetchFlags(status: FlagStatus, signal: AbortSignal): Promise<LoadState> {
  try {
    const res = await fetch(`/api/kb/flags?status=${status}`, { signal })
    const data = (await res.json().catch(() => ({}))) as {
      items?: AnswerFlag[]
      counts?: FlagCounts
      error?: string
      locked?: boolean
      requiredPlan?: PlanId
    }
    if (res.status === 402 && data.locked) return { kind: 'locked', requiredPlan: data.requiredPlan ?? 'pro' }
    if (res.status === 403) return { kind: 'forbidden' }
    if (!res.ok || !data.items || !data.counts) {
      return { kind: 'error', message: data.error ?? 'Could not load flagged answers.' }
    }
    return { kind: 'ready', items: data.items, counts: data.counts }
  } catch {
    return { kind: 'error', message: 'Could not load flagged answers.' }
  }
}

/**
 * Answers a visitor flagged as wrong. Flags are grouped by the article the
 * answer cited, so a team can fix the source once and clear every flag that
 * pointed at it, then mark each flag resolved or dismiss it.
 */
export function FlagsTab({ onCountsChange }: { onCountsChange?: (counts: FlagCounts) => void }) {
  const [status, setStatus] = useState<FlagStatus>('open')
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetchFlags(status, controller.signal).then((next) => {
      if (controller.signal.aborted) return
      setState(next)
      if (next.kind === 'ready') onCountsChange?.(next.counts)
    })
    return () => controller.abort()
  }, [status, reloadKey, onCountsChange])

  const grouped = useMemo(() => (state.kind === 'ready' ? groupFlagsByArticle(state.items) : null), [state])

  if (state.kind === 'locked') {
    return <LockedFeature requiredPlan={state.requiredPlan} featureLabel="Flagged answers" />
  }

  if (state.kind === 'forbidden') {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        Only workspace owners and admins can review flagged answers.
      </p>
    )
  }

  const counts = state.kind === 'ready' ? state.counts : null
  const changed = () => setReloadKey((k) => k + 1)

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        When a visitor gives an answer in your chat widget a thumbs-down, it lands here with the question, the reply and
        the articles it cited. Fix the article, then mark the flag resolved.
      </p>

      <div className="flex min-w-0 gap-1 overflow-x-auto" role="tablist" aria-label="Flag status">
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

      {state.kind === 'loading' && <p className="text-sm text-slate-500">Loading…</p>}
      {state.kind === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      )}
      {state.kind === 'ready' && state.items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          {status === 'open'
            ? 'No flagged answers. When a visitor taps the thumbs-down under a chat answer, it shows up here.'
            : `No ${status} flags.`}
        </p>
      )}

      {grouped && grouped.groups.length > 0 && (
        <div className="space-y-5">
          {grouped.groups.map((group) => (
            <section key={group.articleId} aria-label={`Flags citing ${group.question}`} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="min-w-0 break-words text-sm font-semibold text-slate-900">{group.question}</h3>
                <span className="text-xs text-slate-500">
                  Cited in {group.flags.length} flagged answer{group.flags.length === 1 ? '' : 's'}
                </span>
                <Link href={`/kb#article-${group.articleId}`} className="text-xs font-medium text-blue-700 hover:underline">
                  Open article
                </Link>
              </div>
              <ul className="space-y-3">
                {group.flags.map((flag) => (
                  <FlagCard key={`${group.articleId}:${flag.id}:${flag.status}`} flag={flag} onChanged={changed} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {grouped && grouped.uncited.length > 0 && (
        <section aria-label="Flags with no cited article" className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold text-slate-900">Not tied to an article</h3>
            <span className="text-xs text-slate-500">
              These answers came from general knowledge, or the articles they cited have been deleted.
            </span>
          </div>
          <ul className="space-y-3">
            {grouped.uncited.map((flag) => (
              <FlagCard key={`uncited:${flag.id}:${flag.status}`} flag={flag} onChanged={changed} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
