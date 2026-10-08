'use client'

import { useEffect, useState } from 'react'
import { useUpgrade } from './use-upgrade'
import { planIncludesFeature, planRequiredFor } from '@/lib/billing/entitlements'
import { PLANS } from '@/lib/billing/plans'

/**
 * Settings → Widget note shown only to orgs whose plan does not include widget
 * branding control. Renders nothing while the plan is unknown and when the plan
 * already includes it, so a Pro owner never sees a lock flash in. The server
 * (widget page) is the real gate; this only explains it.
 */
export function WidgetBrandingUpsell() {
  const [planId, setPlanId] = useState<string | null>(null)
  const { upgrade, pending, error } = useUpgrade()

  useEffect(() => {
    let cancelled = false
    fetch('/api/billing/status')
      .then((r) => r.json())
      .then((d: { planId?: string }) => {
        if (!cancelled) setPlanId(d.planId ?? null)
      })
      .catch(() => {
        if (!cancelled) setPlanId(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (planId === null || planIncludesFeature(planId, 'white_label_widget')) return null

  const required = planRequiredFor('white_label_widget')
  const planName = PLANS[required].name

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="min-w-0 flex-1 text-xs text-gray-700">
        Your widget shows the answerLoops logo and a &quot;Powered by answerLoops&quot; line. Changing how the widget
        looks is available on {planName} and above.
      </p>
      <button
        onClick={() => upgrade(required)}
        disabled={pending}
        className="shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? 'Redirecting…' : `Upgrade to ${planName} →`}
      </button>
      {error && <p className="w-full text-xs text-red-600" role="alert">{error}</p>}
    </div>
  )
}
