'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Coverage, CoverageGroup, CoverageStatus } from '@/lib/kb/coverage'
import type { KBSearchResult } from '@/types'

// How many matches the widget puts in front of the model per answer — kept in
// step with MAX_CONTEXT_ARTICLES in app/api/widget/chat/route.ts so the tester
// shows what the assistant would actually draw on.
const WIDGET_CONTEXT_ARTICLES = 5

const STATUS_BADGE: Record<Exclude<CoverageStatus, 'live'>, { label: string; hint: string; className: string }> = {
  unpublished: {
    label: 'Unpublished',
    hint: 'Kept private: the assistant does not use it unless you publish it',
    className: 'bg-slate-100 text-slate-600',
  },
  not_searchable: {
    label: 'Not searchable',
    hint: 'Has no search embedding, so the assistant can never find it. Re-import it to fix.',
    className: 'bg-red-100 text-red-700',
  },
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const tones = {
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    bad: 'text-red-700',
    neutral: 'text-slate-900',
  }
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <p className={`text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  )
}

function GroupBlock({ group }: { group: CoverageGroup }) {
  const hidden = group.total - group.live
  return (
    <details className="group rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <svg
          className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-900">{group.label}</span>
        {group.sourceType && (
          <span className="shrink-0 text-[0.625rem] font-bold uppercase tracking-wide text-slate-400">{group.sourceType}</span>
        )}
        <span className="shrink-0 text-xs text-slate-500">
          {group.live} live
          {hidden > 0 && <span className="text-slate-400"> · {hidden} not used</span>}
        </span>
      </summary>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {group.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start gap-2 px-4 py-2 pl-10">
            <span className="min-w-0 flex-1 break-words text-sm text-slate-700">{item.title}</span>
            {item.status !== 'live' && (
              <span
                title={STATUS_BADGE[item.status].hint}
                className={`shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] font-medium ${STATUS_BADGE[item.status].className}`}
              >
                {STATUS_BADGE[item.status].label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

type TestResult =
  | { kind: 'covered'; matches: KBSearchResult[] }
  | { kind: 'not_covered' }
  | { kind: 'degraded' }
  | { kind: 'error'; message: string }

function QuestionTester() {
  const [question, setQuestion] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  async function run(e: React.FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q) return
    setTesting(true)
    setResult(null)
    try {
      const res = await fetch(`/api/kb/search?q=${encodeURIComponent(q)}`)
      const data = (await res.json()) as { results?: KBSearchResult[]; degraded?: boolean; error?: string }
      if (!res.ok || data.error) {
        setResult({ kind: 'error', message: data.error ?? 'The test could not run.' })
      } else if (data.degraded) {
        // Keyword fallback is not what the widget does, so a hit here proves
        // nothing about the assistant — don't present it as coverage.
        setResult({ kind: 'degraded' })
      } else {
        const matches = (data.results ?? []).slice(0, WIDGET_CONTEXT_ARTICLES)
        setResult(matches.length > 0 ? { kind: 'covered', matches } : { kind: 'not_covered' })
      }
    } catch {
      setResult({ kind: 'error', message: 'The test could not run. Check your AI provider in Settings.' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" aria-labelledby="coverage-tester">
      <h2 id="coverage-tester" className="text-sm font-semibold text-slate-900">Try a customer question</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Runs the same lookup the chat widget uses and shows which articles it would draw on.
      </p>
      <form onSubmit={run} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. How do I reset my password?"
          aria-label="Customer question to test"
          className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm sm:w-auto sm:flex-1"
        />
        <Button type="submit" size="sm" disabled={testing || !question.trim()}>
          {testing ? 'Checking…' : 'Check'}
        </Button>
      </form>

      {result?.kind === 'covered' && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2" role="status">
          <p className="text-xs font-medium text-emerald-800">
            Covered — the assistant would answer from {result.matches.length} article{result.matches.length === 1 ? '' : 's'}:
          </p>
          <ul className="mt-1.5 space-y-1">
            {result.matches.map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-xs text-emerald-900">
                <span className="min-w-0 flex-1 break-words">{m.question}</span>
                <span className="shrink-0 tabular-nums text-emerald-700">{Math.round(m.score * 100)}% match</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result?.kind === 'not_covered' && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2" role="status">
          <p className="text-xs font-medium text-amber-800">Not covered — no article is a close enough match.</p>
          <p className="mt-0.5 text-xs text-amber-700">
            The assistant would answer this from general knowledge, which can be wrong. Add or edit an article to cover it.
          </p>
        </div>
      )}
      {result?.kind === 'degraded' && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2" role="status">
          <p className="text-xs font-medium text-amber-800">Can&apos;t tell — semantic search is unavailable.</p>
          <p className="mt-0.5 text-xs text-amber-700">
            The embedding step failed, so the widget can&apos;t look articles up either.{' '}
            <Link href="/settings" className="font-medium underline">Check your AI provider in Settings →</Link>
          </p>
        </div>
      )}
      {result?.kind === 'error' && (
        <p className="mt-3 text-xs text-red-600" role="alert">{result.message}</p>
      )}
    </section>
  )
}

export function CoverageTab() {
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/kb/coverage')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? 'Failed to load')
        if (!cancelled) setCoverage(data as Coverage)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load what your assistant knows. Try refreshing.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="text-sm text-red-500" role="alert">{error}</p>
  if (!coverage) return <p className="text-sm text-gray-500">Loading…</p>

  const { summary, groups } = coverage

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
        <p className="text-sm text-slate-700">
          Your chat assistant answers from the articles listed here. If a question doesn&apos;t match any of them
          closely enough, it answers from general knowledge instead, and that answer can be wrong. Anything marked
          Unpublished (for example internal documents you keep private) or Not searchable is <strong>not</strong> used by the assistant.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Live articles" value={summary.live} tone="good" />
        <StatCard label="Sources" value={summary.sources} tone="neutral" />
        <StatCard label="Unpublished" value={summary.unpublished} tone="neutral" />
        <StatCard label="Not searchable" value={summary.notSearchable} tone={summary.notSearchable > 0 ? 'bad' : 'neutral'} />
      </div>

      <QuestionTester />

      {summary.total === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          Nothing here yet, so the assistant has no articles to answer from.{' '}
          <Link href="/kb" className="font-medium text-brand-600 hover:underline">Add sources →</Link>
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupBlock key={g.key} group={g} />
          ))}
          {coverage.truncated && (
            <p className="text-xs text-slate-500">
              Showing the first {summary.total} articles. Use the test box above to check a specific question.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
