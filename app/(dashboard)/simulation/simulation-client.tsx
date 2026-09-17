'use client'

import { useState } from 'react'
import type { SimulationResult, SimTicketResult, SimStreamEvent } from '@/app/api/simulation/run/route'

// Curated model lists per provider — only for providers this dropdown can
// pick a *specific* model for. An org's configured chat_model always wins
// for providers not listed here (google/groq/mistral): the dropdown falls
// back to that single model rather than guessing names we don't maintain.
const MODELS_BY_PROVIDER: Record<string, string[]> = {
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
}

const STEP_LABEL: Record<string, string> = {
  embedding: 'Searching knowledge base',
  generating: 'Generating answer',
  assessing: 'Grading confidence',
}

interface SimulationClientProps {
  /** Org's configured chat provider, or null if no org key is configured (simulation then runs on the platform's own OpenAI key). */
  configuredProvider: string | null
  configuredModel: string | null
}

interface ProgressEntry {
  key: string
  index: number
  total: number
  preview: string
  steps: { name: string; done: boolean; confidence?: number }[]
  done: boolean
  confidence?: number
  wouldDeflect?: boolean
}

export default function SimulationClient({ configuredProvider, configuredModel }: SimulationClientProps) {
  // Runnable models: the org's own provider's curated list if we have one
  // for it, else just the org's single configured model, else the
  // platform-key fallback's models (OpenAI only — that's the only provider
  // chatModel()'s sandbox fallback ever actually calls).
  const runnableModels = configuredProvider
    ? MODELS_BY_PROVIDER[configuredProvider] ?? (configuredModel ? [configuredModel] : MODELS_BY_PROVIDER.openai)
    : MODELS_BY_PROVIDER.openai

  const [count, setCount] = useState(20)
  const [model, setModel] = useState(configuredModel && runnableModels.includes(configuredModel) ? configuredModel : runnableModels[0])
  const [threshold, setThreshold] = useState(0.8)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ProgressEntry[]>([])
  const [totalTickets, setTotalTickets] = useState(0)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress([])
    setTotalTickets(0)

    try {
      const res = await fetch('/api/simulation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, model, threshold }),
      })

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let event: SimStreamEvent
          try { event = JSON.parse(line) } catch { continue }

          if (event.type === 'start') {
            setTotalTickets(event.total)
          }

          if (event.type === 'step') {
            setProgress(prev => {
              const existing = prev.find(e => e.index === event.index)
              const stepEntry = { name: STEP_LABEL[event.step] ?? event.step, done: false }
              if (!existing) {
                return [...prev, {
                  key: `ticket-${event.index}`,
                  index: event.index,
                  total: event.total,
                  preview: event.preview,
                  steps: [stepEntry],
                  done: false,
                }]
              }
              // Mark previous steps done, add new step
              return prev.map(e => e.index !== event.index ? e : {
                ...e,
                steps: [...e.steps.map(s => ({ ...s, done: true })), stepEntry],
              })
            })
          }

          if (event.type === 'ticket_done') {
            setProgress(prev => prev.map(e => e.index !== event.index ? e : {
              ...e,
              steps: e.steps.map(s => ({ ...s, done: true })),
              done: true,
              confidence: event.result.simConfidence,
              wouldDeflect: event.result.simWouldDeflect,
            }))
          }

          if (event.type === 'done') {
            setResult({ config: event.config, results: event.results, summary: event.summary })
          }

          if (event.type === 'error') {
            throw new Error(event.message)
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setRunning(false)
    }
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  const conf = (n: number) => (
    <span className={n >= 0.8 ? 'text-green-400' : n >= 0.5 ? 'text-yellow-400' : 'text-red-400'}>
      {(n * 100).toFixed(0)}%
    </span>
  )

  const doneCount = progress.filter(e => e.done).length

  return (
    <div className="dashboard-page max-w-6xl space-y-7">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-blue-600">
          <span className="h-px w-5 bg-blue-500" />
          Safe evaluation
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl">Simulation Mode</h1>
        <p className="mt-1 text-sm text-slate-500">
          Replay historical tickets through the AI pipeline — no writes, no messages sent.
          Compare what the AI <em>would</em> do against what actually happened.
        </p>
      </div>

      {/* Config */}
      <div className="relative overflow-hidden rounded-2xl border dashboard-dark-panel border-[#375875] bg-[#082e50] p-5 text-white shadow-[0_24px_65px_-36px_rgba(15,23,42,0.3)] sm:p-6">
        <div className="pointer-events-none absolute -right-12 -top-24 h-52 w-52 rounded-full bg-blue-400/10 blur-3xl" />
        <h2 className="relative text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Simulation controls</h2>
        <div className="relative mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tickets to replay</label>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={e => setCount(Number(e.target.value))}
              disabled={running}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={running}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
            >
              {runnableModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {!configuredProvider && (
              <p className="mt-1 text-[0.6875rem] text-amber-400">
                No AI provider connected — running on the platform's default OpenAI key.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Deflect threshold ({threshold})
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              disabled={running}
              className="w-full mt-2 disabled:opacity-50"
            />
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="relative mt-5 rounded-lg bg-[#dceff0] px-5 py-2.5 text-sm font-semibold text-[#082e50] shadow-lg shadow-blue-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Running simulation…' : 'Run simulation'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Live progress */}
      {(running || (progress.length > 0 && !result)) && (
        <div className="dashboard-dark-panel bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">
              {running ? 'Running…' : 'Complete'}
            </h2>
            {totalTickets > 0 && (
              <span className="text-xs text-gray-500">
                {doneCount} / {totalTickets} tickets
              </span>
            )}
          </div>

          {/* Progress bar */}
          {totalTickets > 0 && (
            <div className="h-1 bg-gray-800">
              <div
                className="h-1 bg-brand-600 transition-all duration-300"
                style={{ width: `${(doneCount / totalTickets) * 100}%` }}
              />
            </div>
          )}

          <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
            {progress.map(entry => (
              <div key={entry.key} className="text-sm">
                {/* Ticket header */}
                <div className="flex items-center gap-2 mb-1">
                  {entry.done ? (
                    <span className="text-green-400 text-xs">✓</span>
                  ) : (
                    <span className="inline-block h-3 w-3 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" />
                  )}
                  <span className="text-gray-400 text-xs font-mono">
                    {entry.index}/{entry.total}
                  </span>
                  <span className="text-gray-300 text-xs truncate max-w-md">
                    {entry.preview}{entry.preview.length >= 80 ? '…' : ''}
                  </span>
                  {entry.done && entry.confidence !== undefined && (
                    <span className={`text-xs ml-auto shrink-0 font-mono ${
                      entry.confidence >= 0.8 ? 'text-green-400' : entry.confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {(entry.confidence * 100).toFixed(0)}% · {entry.wouldDeflect ? 'Auto' : 'Human'}
                    </span>
                  )}
                </div>

                {/* Sub-steps */}
                <div className="ml-5 space-y-0.5">
                  {entry.steps.map((step, si) => (
                    <div key={si} className="flex items-center gap-1.5 text-xs">
                      {step.done ? (
                        <span className="text-gray-600">✓</span>
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-full border border-gray-500 border-t-transparent animate-spin" />
                      )}
                      <span className={step.done ? 'text-gray-600' : 'text-gray-400'}>
                        {step.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {running && progress.length === 0 && (
              <p className="text-xs text-gray-500">Fetching tickets…</p>
            )}
          </div>
        </div>
      )}

      {result && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Tickets', value: result.summary.total },
              { label: 'Would deflect', value: pct(result.summary.deflectRate) },
              { label: 'Actually deflected', value: pct(result.summary.actualDeflectRate) },
              { label: 'Match rate', value: pct(result.summary.matchRate) },
              { label: 'Avg confidence', value: pct(result.summary.avgConfidence) },
              { label: 'Avg time', value: `${(result.summary.avgDurationMs / 1000).toFixed(1)}s` },
            ].map(({ label, value }) => (
              <div key={label} className="dashboard-dark-panel bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-xl font-bold text-white">{value}</div>
                <div className="text-xs text-gray-400 mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* Delta callout */}
          {(() => {
            const delta = result.summary.deflectRate - result.summary.actualDeflectRate
            const color = delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-gray-400'
            const label = delta > 0
              ? `This model/threshold combo would deflect ${pct(Math.abs(delta))} more tickets than production.`
              : delta < 0
              ? `This model/threshold combo would deflect ${pct(Math.abs(delta))} fewer tickets than production.`
              : 'Deflect rate matches production exactly.'
            return (
              <div className={`dashboard-dark-panel bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm ${color}`}>
                {label}
              </div>
            )
          })()}

          {/* Per-ticket results */}
          <div className="dashboard-dark-panel bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-gray-300">Per-ticket results</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <th className="px-4 py-2 text-left">ID</th>
                    <th className="px-4 py-2 text-left">Question</th>
                    <th className="px-4 py-2 text-left">Category</th>
                    <th className="px-4 py-2 text-center">Confidence</th>
                    <th className="px-4 py-2 text-center">Sim deflect</th>
                    <th className="px-4 py-2 text-center">Actual</th>
                    <th className="px-4 py-2 text-center">Match</th>
                    <th className="px-4 py-2 text-left">Reasoning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {result.results.map((r: SimTicketResult) => (
                    <tr key={r.id} className="hover:bg-gray-800/50">
                      <td className="px-4 py-3 text-gray-500">#{r.id}</td>
                      <td className="px-4 py-3 text-gray-300 max-w-xs">
                        <div className="truncate">{r.content}</div>
                        <details className="mt-1">
                          <summary className="text-xs text-brand-400 cursor-pointer">Sim answer</summary>
                          <div className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{r.simAnswer}</div>
                        </details>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{r.category ?? '—'}</td>
                      <td className="px-4 py-3 text-center">{conf(r.simConfidence)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={r.simWouldDeflect ? 'text-green-400' : 'text-gray-500'}>
                          {r.simWouldDeflect ? 'Auto' : 'Human'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={r.actualWouldDeflect ? 'text-green-400' : 'text-gray-500'}>
                          {r.actualWouldDeflect ? 'Auto' : 'Human'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.match
                          ? <span className="text-green-400">✓</span>
                          : <span className="text-red-400">✗</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-xs">
                        <div className="truncate">{r.simReasoning}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
