'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  type NavState,
  CTA_CLASS,
  SECONDARY_CTA_CLASS,
  SIGNIN_HREF,
  SIGNIN_LABEL,
  START_HREF,
  START_LABEL,
  CHECKOUT_HREF,
  DASHBOARD_HREF,
} from '@/components/marketing/nav-shared'

/**
 * The marketing header CTA, as a client island.
 *
 * The marketing pages themselves are static/prerendered so crawlers and
 * first-paint don't pay for a per-request session read (that read is what
 * forced every page to `dynamic = 'force-dynamic'`, which in turn meant
 * Cloudflare could cache none of them). This island restores the personalized
 * CTA after hydration by asking `/api/nav-state`.
 *
 * When `initialState` is passed (server pages that still resolve the session,
 * e.g. /pricing, and the component tests) it's used verbatim and no fetch
 * happens — the output is identical to the old server-rendered header.
 */
export function NavCta({
  variant,
  initialState,
}: {
  variant: 'header' | 'drawer'
  initialState?: NavState
}) {
  const [state, setState] = useState<NavState>(initialState ?? 'anonymous')

  useEffect(() => {
    // A caller that already knows the state doesn't need the round-trip.
    if (initialState !== undefined) return
    if (typeof fetch !== 'function') return

    let alive = true
    fetch('/api/nav-state', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { state?: NavState } | null) => {
        if (
          alive &&
          data &&
          (data.state === 'anonymous' ||
            data.state === 'no-plan' ||
            data.state === 'active')
        ) {
          setState(data.state)
        }
      })
      .catch(() => {
        // Network failure just leaves the anonymous default in place.
      })
    return () => {
      alive = false
    }
  }, [initialState])

  if (variant === 'drawer') {
    // The drawer only carries the anonymous sign-in pair — the header hides
    // those below sm, so without them a phone has no way to sign in at all.
    if (state !== 'anonymous') return null
    return (
      <>
        <Link
          href={SIGNIN_HREF}
          className="rounded-lg px-3 py-3 text-[0.91875rem] font-medium text-ink-600 hover:bg-gray-100"
        >
          {SIGNIN_LABEL}
        </Link>
        <Link
          href={START_HREF}
          className="mt-1 rounded-lg bg-blue-600 px-3 py-3 text-center text-[0.91875rem] font-semibold !text-white shadow-sm"
        >
          <span style={{ color: '#fff', WebkitTextFillColor: '#fff' }}>
            {START_LABEL}
          </span>
        </Link>
      </>
    )
  }

  if (state === 'active') {
    return (
      <Link href={DASHBOARD_HREF} className={CTA_CLASS}>
        <span
          className="!text-white"
          style={{ color: '#fff', WebkitTextFillColor: '#fff' }}
        >
          Go to dashboard →
        </span>
      </Link>
    )
  }

  if (state === 'no-plan') {
    return (
      <Link href={CHECKOUT_HREF} className={CTA_CLASS}>
        <span
          className="!text-white"
          style={{ color: '#fff', WebkitTextFillColor: '#fff' }}
        >
          Choose a plan →
        </span>
      </Link>
    )
  }

  return (
    <>
      <Link href={SIGNIN_HREF} className={SECONDARY_CTA_CLASS}>
        {SIGNIN_LABEL}
      </Link>
      <Link href={START_HREF} className={CTA_CLASS}>
        <span
          className="!text-white"
          style={{ color: '#fff', WebkitTextFillColor: '#fff' }}
        >
          {START_LABEL}
        </span>
      </Link>
    </>
  )
}
