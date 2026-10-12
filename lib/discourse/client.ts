import crypto from 'crypto'
import { safeFetch } from '@/lib/http/safe-fetch'

/**
 * Shared helpers for the Discourse channel. Discourse authenticates writes
 * with an `Api-Key` + `Api-Username` header pair (the key is admin-scoped,
 * the username is the account the action is attributed to) and signs inbound
 * webhooks with an HMAC-SHA256 of the raw body under a per-webhook secret.
 */

interface DiscourseCreds {
  siteUrl: string
  apiKey: string
  apiUsername: string
}

/** Strip a trailing slash so `${siteUrl}/posts.json` never doubles up. */
export function normalizeSiteUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * Calls the tenant's Discourse site. The site URL is tenant-supplied, so the
 * request only goes to public https hosts (see lib/http/safe-fetch.ts) and
 * throws UnsafeUrlError otherwise. Bodies must be strings.
 */
export async function discourseFetch(
  creds: DiscourseCreds,
  path: string,
  init: { method?: string; headers?: HeadersInit; body?: string; signal?: AbortSignal | null } = {}
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Api-Key', creds.apiKey)
  headers.set('Api-Username', creds.apiUsername)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return safeFetch(`${normalizeSiteUrl(creds.siteUrl)}${path}`, {
    method: init.method,
    headers,
    body: init.body,
    signal: init.signal,
    timeoutMs: 10_000,
  })
}

/**
 * Verify a Discourse webhook. The header is `X-Discourse-Event-Signature:
 * sha256=<hex>` = HMAC-SHA256(rawBody, secret). Comparison is constant-time.
 */
export function verifyDiscourseSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
