/**
 * Resolves the client IP for rate-limiting purposes without trusting
 * caller-supplied header values.
 *
 * `x-forwarded-for` is a *list* that each hop appends to, so its leftmost
 * entry is whatever the original client claimed — an unauthenticated caller
 * can put an arbitrary value there and mint a fresh rate-limit bucket per
 * request, which defeats every per-IP limiter keyed on it (Issues Backlog
 * item 8). Only the entries appended by infrastructure we control are
 * trustworthy, and those are the *rightmost* ones.
 *
 * `TRUST_PROXY_HOPS` is how many proxies sit between the public internet and
 * this process, each of which appends one entry. Default 1, matching the
 * single-edge deployment (Railway, or Cloudflare in front of it). Set it to
 * the real hop count if you add another layer — too high and you read a
 * spoofed entry, too low and every request behind the edge shares one bucket.
 */
import { isOriginVerified, originVerifyConfigured } from './origin-guard'

const DEFAULT_TRUST_PROXY_HOPS = 1

export function trustedProxyHops(): number {
  const raw = Number(process.env.TRUST_PROXY_HOPS ?? DEFAULT_TRUST_PROXY_HOPS)
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_TRUST_PROXY_HOPS
  return Math.floor(raw)
}

/**
 * Whether `cf-connecting-ip` may be believed for this request.
 *
 * The header is only meaningful when the app can be reached solely through
 * Cloudflare, which the app cannot tell on its own.
 *
 * - ORIGIN_VERIFY_SECRET configured (any deployment): only when the request
 *   carries the matching edge header.
 * - Production without the secret: only on a self-hosted instance whose
 *   operator has stated it is reachable solely through Cloudflare, with
 *   TRUST_CLOUDFLARE_IP_HEADER=true. Never on the managed cloud. Otherwise the
 *   `x-forwarded-for` policy below is used, which still gives each visitor
 *   their own address behind Cloudflare when TRUST_PROXY_HOPS is right.
 * - Local development: accepted, so trying the app behind a tunnel needs no
 *   extra setup.
 */
function trustsCloudflareHeader(req: { headers: Headers }): boolean {
  if (originVerifyConfigured()) return isOriginVerified(req)
  if (process.env.NODE_ENV !== 'production') return true
  if (process.env.DEPLOYMENT_MODE === 'cloud') return false
  return process.env.TRUST_CLOUDFLARE_IP_HEADER?.trim().toLowerCase() === 'true'
}

/** Takes anything with headers — NextRequest and plain Request both qualify. */
export function clientIp(req: { headers: Headers }): string {
  // Cloudflare overwrites (never appends to) this header, so when the request
  // is known to have come through the edge it is the best source.
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf && trustsCloudflareHeader(req)) return cf

  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
    if (hops.length) {
      // Count in from the right: with one trusted proxy, the last entry is the
      // one that proxy appended and is the real peer address. Anything the
      // client injected sits to the left of it and is ignored. Clamp so a
      // shorter-than-expected chain reads the leftmost entry rather than
      // undefined.
      const index = Math.max(0, hops.length - trustedProxyHops())
      return hops[index]
    }
  }

  // x-real-ip is set by the proxy in single-hop setups and is not a list, so
  // there is no attacker-controlled prefix to strip.
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}
