/**
 * How long a dashboard sign-in lasts without activity.
 *
 * Two pieces enforce it together:
 *
 * - The session cookie's own lifetime (`session.maxAge` in auth.ts). Every
 *   request that reaches the server re-issues the cookie with a fresh expiry,
 *   so it lapses only after this long with no requests at all — a closed or
 *   backgrounded tab.
 * - The dashboard's idle timer (components/auth/idle-sign-out.tsx). An open
 *   dashboard tab keeps making requests on its own (live updates, their
 *   reconnects and refresh backstop), which would keep the cookie alive
 *   forever, so the browser also tracks real activity — clicks, typing,
 *   scrolling — across every open tab and signs out after this long without
 *   any.
 *
 * Defaults to 8 hours. A self-hosted instance can change it with
 * AUTH_SESSION_IDLE_HOURS (see content/docs/reference/environment-variables.mdx).
 * A missing, non-numeric or out-of-range value falls back to the default
 * rather than failing, so a typo never locks everyone out.
 */

export const DEFAULT_SESSION_IDLE_HOURS = 8
export const MIN_SESSION_IDLE_HOURS = 1
/** 30 days: the auth library's own default, and the longest this allows. */
export const MAX_SESSION_IDLE_HOURS = 720

export const SESSION_IDLE_HOURS_ENV = 'AUTH_SESSION_IDLE_HOURS'

type Env = Readonly<Record<string, string | undefined>>

export function sessionIdleHours(env: Env = process.env): number {
  const raw = env[SESSION_IDLE_HOURS_ENV]?.trim()
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_SESSION_IDLE_HOURS
  const hours = Number(raw)
  if (hours < MIN_SESSION_IDLE_HOURS || hours > MAX_SESSION_IDLE_HOURS) {
    return DEFAULT_SESSION_IDLE_HOURS
  }
  return hours
}

export function sessionIdleSeconds(env: Env = process.env): number {
  return sessionIdleHours(env) * 60 * 60
}
