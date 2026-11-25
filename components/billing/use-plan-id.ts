'use client'

import { useEffect, useState } from 'react'

// One request shared by everything on the page that needs the plan (the sidebar
// and the section switcher), instead of each asking on its own.
let pending: Promise<string | null> | null = null

function fetchPlanId(): Promise<string | null> {
  if (!pending) {
    pending = fetch('/api/billing/status')
      .then((r) => r.json())
      .then((d: { planId?: string }) => d.planId ?? null)
      .catch(() => null)
  }
  return pending
}

/** The workspace's plan id, or null while it loads or if it cannot be read. */
export function usePlanId(): string | null {
  const [planId, setPlanId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchPlanId().then((id) => { if (!cancelled) setPlanId(id) })
    return () => { cancelled = true }
  }, [])
  return planId
}

/** Forget the shared answer, for tests. */
export function resetPlanIdCache() {
  pending = null
}
