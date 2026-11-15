'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  getSourceSupportSettingsAction,
  saveSourceSupportSettingsAction,
  type SourceSupportResult,
} from '@/lib/actions/source-support'
import { Button } from '@/components/ui/button'
import type { SupportSettings } from '@/lib/db/queries/kb-support'

const SURFACES = [
  { name: 'widgetEnabled', label: 'Website chat widget' },
  { name: 'ticketEnabled', label: 'Support ticket drafts' },
  { name: 'discordEnabled', label: 'Discord /ask' },
  { name: 'agentApiEnabled', label: 'Agent API and MCP' },
] as const

/** The stored 0..1 rate as the percentage the form shows; empty when unset. */
function percentOf(rate: number | null): string {
  if (rate === null) return ''
  return String(Math.round(rate * 10_000) / 100)
}

type LoadState = { status: 'loading' } | { status: 'denied'; message: string } | { status: 'ready'; settings: SupportSettings }

/**
 * Source support switches: which channels have their answers checked against
 * the articles supplied to them, how many, and whether short evidence text may
 * be kept. Owners and admins only; the server actions are the real gate, and a
 * member sees a note instead of the form.
 */
export function SourceSupportSection() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  // The last result, plus the last values that were actually stored, so a refused save keeps showing them.
  const [action, formAction, pending] = useActionState<{ result: SourceSupportResult; saved: SupportSettings | null } | null, FormData>(
    async (prev, formData) => {
      const result = await saveSourceSupportSettingsAction(null, formData)
      return { result, saved: result.settings ?? prev?.saved ?? null }
    },
    null
  )
  const state = action?.result ?? null

  useEffect(() => {
    let cancelled = false
    getSourceSupportSettingsAction()
      .then((result) => {
        if (cancelled) return
        if (result.settings) setLoad({ status: 'ready', settings: result.settings })
        else setLoad({ status: 'denied', message: result.error ?? 'Settings unavailable' })
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'denied', message: 'The settings could not be loaded. Reload the page to try again.' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A successful save becomes what the form shows; a refused one leaves the typed values in place.
  const settings = action?.saved ?? (load.status === 'ready' ? load.settings : null)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-sm font-medium text-gray-900">Source support</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Checks whether the knowledge-base articles supplied to an answer support what it says. The check runs after the reply has been sent, so it never changes or delays a reply. Off by default.
        </p>
      </div>

      {load.status === 'loading' && <p className="text-sm text-gray-400">Loading…</p>}

      {load.status === 'denied' && (
        <p className="text-sm text-gray-500" role="note">
          {load.message === 'You do not have permission to do that.'
            ? 'Only workspace owners and admins can view or change these settings.'
            : load.message}
        </p>
      )}

      {settings && (
        // Remounted after each save so the boxes show what was stored, not what was typed.
        <SourceSupportForm key={JSON.stringify(settings)} settings={settings} action={formAction} state={state} pending={pending} />
      )}
    </div>
  )
}

interface Draft {
  widgetEnabled: boolean
  ticketEnabled: boolean
  discordEnabled: boolean
  agentApiEnabled: boolean
  samplingPercent: string
  dailyLimit: string
  excerptStorageEnabled: boolean
}

/**
 * The form itself. Its fields are controlled, so a refused save keeps what was
 * typed (React resets uncontrolled fields after every form action).
 */
function SourceSupportForm({
  settings,
  action,
  state,
  pending,
}: {
  settings: SupportSettings
  action: (formData: FormData) => void
  state: SourceSupportResult | null
  pending: boolean
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    widgetEnabled: settings.widgetEnabled,
    ticketEnabled: settings.ticketEnabled,
    discordEnabled: settings.discordEnabled,
    agentApiEnabled: settings.agentApiEnabled,
    samplingPercent: percentOf(settings.samplingRate),
    dailyLimit: settings.dailyLimit === null ? '' : String(settings.dailyLimit),
    excerptStorageEnabled: settings.excerptStorageEnabled,
  }))
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  return (
    <form action={action} className="space-y-5">
      <fieldset>
        <legend className="text-xs font-medium text-gray-700 mb-2">Check answers from</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SURFACES.map((s) => (
            <label key={s.name} className="flex min-w-0 items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                name={s.name}
                checked={draft[s.name]}
                onChange={(e) => set(s.name, e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-gray-300"
              />
              <span className="min-w-0 break-words">{s.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="source-support-sampling" className="block text-xs font-medium text-gray-700 mb-1">
            Share of answers to check (%)
          </label>
          <input
            id="source-support-sampling"
            name="samplingPercent"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="any"
            value={draft.samplingPercent}
            onChange={(e) => set('samplingPercent', e.target.value)}
            placeholder="Not set"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <p className="text-[0.6875rem] text-gray-400 mt-1">Leave empty to check none.</p>
        </div>
        <div className="min-w-0">
          <label htmlFor="source-support-daily" className="block text-xs font-medium text-gray-700 mb-1">
            Most checks per day
          </label>
          <input
            id="source-support-daily"
            name="dailyLimit"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={draft.dailyLimit}
            onChange={(e) => set('dailyLimit', e.target.value)}
            placeholder="Not set"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <p className="text-[0.6875rem] text-gray-400 mt-1">Counted per UTC day. Leave empty to check none.</p>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <label className="flex min-w-0 items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            name="excerptStorageEnabled"
            checked={draft.excerptStorageEnabled}
            onChange={(e) => set('excerptStorageEnabled', e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
          />
          <span className="min-w-0">
            Keep short evidence excerpts
            <span className="block text-xs text-gray-500 mt-0.5">
              Separate from the switches above and off by default. When on, one sentence of the answer and one of the article (under 300 characters each) are kept, and removed 90 days after the answer. Turning it off deletes the stored excerpts.
            </span>
          </span>
        </label>
      </div>

      <p className="text-xs text-gray-500">
        Answers that are not checked (switched off, outside the share, over the daily limit, or not finished) are shown as not assessed, never as unsupported.
      </p>

      {state?.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}
      {state?.settings && !pending && <p className="text-xs text-green-600">Saved.</p>}

      <Button type="submit" size="sm" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
