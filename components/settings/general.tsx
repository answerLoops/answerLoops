'use client'

import { useActionState, useState } from 'react'
import { updateSLAAction } from '@/lib/actions/sla'
import { saveROIConfigAction } from '@/lib/actions/roi'
import { Button } from '@/components/ui/button'
import type { SLAConfig } from '@/types'

function SLARow({ config }: { config: SLAConfig }) {
  const [state, formAction, isPending] = useActionState(updateSLAAction, null)

  return (
    <form action={formAction} className="grid grid-cols-4 items-center">
      <input type="hidden" name="priority" value={config.priority} />
      <div className="px-4 py-3 text-sm font-medium capitalize text-gray-800">{config.priority}</div>
      <div className="px-4 py-3">
        <input type="number" name="responseHours" defaultValue={config.response_hours} min={1}
          className="w-20 rounded border border-gray-200 px-2 py-1 text-sm text-center" />
      </div>
      <div className="px-4 py-3">
        <input type="number" name="resolveHours" defaultValue={config.resolve_hours} min={1}
          className="w-20 rounded border border-gray-200 px-2 py-1 text-sm text-center" />
      </div>
      <div className="px-4 py-3 flex items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  )
}


function ROISection() {
  const [state, formAction, pending] = useActionState(saveROIConfigAction, null)
  const [editing, setEditing] = useState(false)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-medium text-gray-900">ROI Assumptions</p>
          <p className="text-xs text-gray-500 mt-0.5">Used to calculate time and money saved on the Analytics page.</p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Minutes per ticket
              </label>
              <input
                name="minutesPerTicket"
                type="number"
                min={1}
                max={480}
                defaultValue={10}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <p className="text-[0.6875rem] text-gray-400 mt-1">Average staff time to answer one question manually.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Staff hourly rate ($)
              </label>
              <input
                name="staffHourlyRate"
                type="number"
                min={1}
                max={10000}
                defaultValue={50}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <p className="text-[0.6875rem] text-gray-400 mt-1">Fully-loaded cost per hour for your support staff.</p>
            </div>
          </div>

          {state && 'error' in state && (
            <p className="text-xs text-red-600">{state.error}</p>
          )}
          {state && 'success' in state && (
            <p className="text-xs text-green-600">Saved.</p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-gray-500">
          Using defaults (10 min/ticket · $50/hr) unless you set custom values above.
        </p>
      )}
    </div>
  )
}


/** The General tab: how fast tickets should be answered, and the ROI numbers behind Analytics. */
export function GeneralSection({ slaConfigs }: { slaConfigs: SLAConfig[] | null }) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">SLA Configuration</h2>
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden divide-y divide-gray-100">
          <div className="grid grid-cols-4 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium">
            <div className="px-4 py-2.5">Priority</div>
            <div className="px-4 py-2.5">Response (hours)</div>
            <div className="px-4 py-2.5">Resolve (hours)</div>
            <div className="px-4 py-2.5" />
          </div>
          {slaConfigs === null ? (
            <div className="px-4 py-3 text-sm text-gray-400">Loading…</div>
          ) : (
            slaConfigs.map((config) => <SLARow key={config.priority} config={config} />)
          )}
        </div>
      </section>
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Analytics</h2>
        <ROISection />
      </section>
    </div>
  )
}
