'use client'

import { useEffect } from 'react'
import { logoutAfterIdle } from '@/lib/actions/auth'

/**
 * Signs the dashboard out after `idleHours` with no activity.
 *
 * The session cookie already lapses after that long with no requests (see
 * lib/auth/session-lifetime.ts), but an open dashboard tab keeps making
 * requests by itself — live updates, their reconnects, the refresh backstop —
 * so on its own the cookie would never lapse while a tab sits open on screen.
 * This counts only what a person does: clicks, taps, typing, scrolling.
 *
 * The time of the last activity is shared through localStorage, so working in
 * one tab keeps every other open dashboard tab signed in too. The check runs
 * every minute and again whenever the tab regains focus, because timers are
 * paused while a laptop sleeps.
 */

export const LAST_ACTIVITY_KEY = 'answerloops:last-activity'
export const CHECK_INTERVAL_MS = 60 * 1000
/** Activity is recorded at most this often; finer detail changes nothing. */
export const ACTIVITY_WRITE_THROTTLE_MS = 30 * 1000

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

function readLastActivity(fallback: number): number {
  try {
    const stored = Number(window.localStorage.getItem(LAST_ACTIVITY_KEY))
    return Number.isFinite(stored) && stored > 0 ? Math.max(stored, fallback) : fallback
  } catch {
    return fallback
  }
}

function writeLastActivity(at: number): void {
  try {
    window.localStorage.setItem(LAST_ACTIVITY_KEY, String(at))
  } catch {
    // Storage blocked (some private modes): this tab still tracks its own
    // activity in memory, it just cannot share it with other tabs.
  }
}

export function IdleSignOut({ idleHours }: { idleHours: number }) {
  useEffect(() => {
    const idleMs = idleHours * 60 * 60 * 1000
    // This tab's own last activity, used when storage is unavailable and as a
    // floor when another tab's stored value is older.
    let localLast = Date.now()
    let lastWrite = localLast
    let signingOut = false
    // Opening or navigating to a dashboard page is activity.
    writeLastActivity(localLast)

    const onActivity = () => {
      const now = Date.now()
      localLast = now
      if (now - lastWrite >= ACTIVITY_WRITE_THROTTLE_MS) {
        lastWrite = now
        writeLastActivity(now)
      }
    }

    const check = () => {
      if (signingOut) return
      const last = readLastActivity(localLast)
      if (Date.now() - last < idleMs) return
      signingOut = true
      void logoutAfterIdle(`${window.location.pathname}${window.location.search}`)
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }

    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { capture: true, passive: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    const interval = window.setInterval(check, CHECK_INTERVAL_MS)

    return () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, { capture: true })
      }
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
      window.clearInterval(interval)
    }
  }, [idleHours])

  return null
}
