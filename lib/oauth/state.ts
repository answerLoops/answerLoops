import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextResponse } from 'next/server'

// Signed `state` for the outbound OAuth / app-install flows (Discord, Slack,
// GitHub, Gmail, Outlook). The value carries the org id, the initiating user
// id, the provider and a random nonce across the redirect to the third party
// and back. The signature lets the callback treat those fields as ones this
// server issued; the nonce is also set in a short-lived httpOnly cookie at
// install time, so a callback only succeeds in the browser that started the
// flow, and only once (the cookie is cleared as soon as the callback runs).
//
// Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 of the first part)>`
// keyed with AUTH_SECRET (already required for the app to boot). The payload
// always carries `ts`; verify() enforces a max age.

const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000

type OAuthProvider = 'slack' | 'github' | 'discord' | 'gmail' | 'outlook'

function key(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set — cannot sign OAuth state')
  return Buffer.from(secret, 'utf8')
}

function sign(body: string): string {
  return createHmac('sha256', key()).update(body).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

interface OAuthStatePayload {
  orgId: number
  /** The user who started the flow. */
  uid: number
  /** Random single-use value that is also held in the caller's nonce cookie. */
  nonce: string
  /** Which integration the state was issued for. */
  provider: OAuthProvider
  ts: number
  /** Which surface started the flow, so the callback redirects back to it. */
  from?: string
}

export function signOAuthState(payload: Omit<OAuthStatePayload, 'ts'> & { ts?: number }): string {
  const full: OAuthStatePayload = { ...payload, ts: payload.ts ?? Date.now() }
  const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url')
  return `${body}.${sign(body)}`
}

/**
 * Parse and authenticate a `state` value. Throws on a missing value, a bad
 * signature, malformed JSON, or an expired timestamp — callers treat any throw
 * as `invalid_state` and must not fall back to a default org.
 */
export function verifyOAuthState(
  raw: string | null | undefined,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): OAuthStatePayload {
  if (!raw) throw new Error('missing state')
  const dot = raw.lastIndexOf('.')
  if (dot < 1) throw new Error('malformed state')

  const body = raw.slice(0, dot)
  const provided = Buffer.from(raw.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(body), 'base64url')
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('bad state signature')
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload
  if (!Number.isInteger(payload.orgId) || payload.orgId < 1) throw new Error('bad state payload')
  if (!Number.isInteger(payload.uid) || payload.uid < 1) throw new Error('bad state payload')
  if (typeof payload.nonce !== 'string' || payload.nonce.length < 16) throw new Error('bad state payload')
  if (typeof payload.provider !== 'string') throw new Error('bad state payload')
  if (!Number.isFinite(payload.ts) || Date.now() - payload.ts > maxAgeMs) throw new Error('expired state')
  return payload
}

interface OAuthCaller {
  userId: number
  orgId: number
}

/**
 * Authenticate a callback's `state` against the signed-in caller and the nonce
 * cookie set when the flow began. Throws unless the state was issued by this
 * server, for this provider, to this user and org, and the cookie still holds
 * the matching nonce (a missing cookie — already used, expired, or a different
 * browser — fails).
 */
export function verifyOAuthCallback(args: {
  provider: OAuthProvider
  state: string | null | undefined
  cookieNonce: string | null | undefined
  caller: OAuthCaller
  maxAgeMs?: number
}): OAuthStatePayload {
  const decoded = verifyOAuthState(args.state, args.maxAgeMs)
  if (decoded.provider !== args.provider) throw new Error('provider mismatch')
  if (decoded.uid !== args.caller.userId) throw new Error('user mismatch')
  if (decoded.orgId !== args.caller.orgId) throw new Error('org mismatch')
  if (!args.cookieNonce) throw new Error('missing nonce cookie')
  if (!safeEqual(decoded.nonce, args.cookieNonce)) throw new Error('nonce mismatch')
  return decoded
}

export function oauthNonceCookieName(provider: OAuthProvider): string {
  return `answerloops-oauth-${provider}`
}

function nonceCookieOptions(maxAgeSeconds: number) {
  const domain = process.env.AUTH_COOKIE_DOMAIN
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeSeconds,
    path: '/',
    ...(domain ? { domain } : {}),
  }
}

/**
 * Issue a signed state for an install flow and the nonce that must be set as a
 * cookie on the same response (see {@link setOAuthNonceCookie}).
 */
export function createOAuthState(args: {
  provider: OAuthProvider
  orgId: number
  userId: number
  from?: string
}): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString('base64url')
  const state = signOAuthState({
    orgId: args.orgId,
    uid: args.userId,
    nonce,
    provider: args.provider,
    ...(args.from ? { from: args.from } : {}),
  })
  return { state, nonce }
}

export function setOAuthNonceCookie<T extends NextResponse>(res: T, provider: OAuthProvider, nonce: string): T {
  res.cookies.set(oauthNonceCookieName(provider), nonce, nonceCookieOptions(DEFAULT_MAX_AGE_MS / 1000))
  return res
}

export function clearOAuthNonceCookie<T extends NextResponse>(res: T, provider: OAuthProvider): T {
  res.cookies.set(oauthNonceCookieName(provider), '', nonceCookieOptions(0))
  return res
}
