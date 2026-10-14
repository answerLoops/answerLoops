import crypto from 'crypto'

/**
 * Verifies a request actually passed through our edge/CDN proxy before any
 * code trusts the proxy-supplied client-IP header (see lib/http/client-ip.ts).
 * That header is only spoof-proof if the origin is unreachable except through
 * the edge proxy — if the origin's address is reachable directly, any caller
 * can set the header themselves and mint a fresh rate-limit bucket per
 * request, defeating the per-IP limiter on every public pre-auth POST route
 * (MCP, Agent API, widget chat).
 *
 * Mitigation: a rule on the edge proxy (most CDNs offer a "modify request
 * header" feature) adds a static header carrying this secret on every request
 * it forwards to the origin. A request that reaches the origin without it did
 * not come through the edge and is rejected outright — softening to a
 * fallback IP source would still let the caller dodge the edge's WAF/DDoS
 * layer entirely, not just spoof the IP.
 *
 * Unenforced (passes everything through) until ORIGIN_VERIFY_SECRET is set,
 * so this is safe to deploy before the edge-side rule exists and safe for
 * local dev / staging with no edge proxy in front at all.
 */
const ORIGIN_VERIFY_HEADER = 'x-origin-verify'

function timingSafeStringEqual(a: string, b: string): boolean {
  // Hash both to a fixed 32-byte digest before comparing — crypto.timingSafeEqual
  // requires equal-length buffers, and comparing raw strings of different
  // lengths short-circuits (leaking length via timing) before it ever runs.
  const digestA = crypto.createHash('sha256').update(a).digest()
  const digestB = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(digestA, digestB)
}

export function originVerifyConfigured(): boolean {
  return Boolean(process.env.ORIGIN_VERIFY_SECRET?.trim())
}

/**
 * True only when ORIGIN_VERIFY_SECRET is configured AND this request carries
 * the matching header, i.e. it demonstrably came through the edge proxy.
 * Unlike verifyOriginProxy this never "passes" an unconfigured deployment, so
 * it is the right check for deciding whether to believe a proxy-supplied
 * header (see lib/http/client-ip.ts).
 */
export function isOriginVerified(req: { headers: Headers }): boolean {
  const secret = process.env.ORIGIN_VERIFY_SECRET?.trim()
  if (!secret) return false
  const provided = req.headers.get(ORIGIN_VERIFY_HEADER)
  return Boolean(provided) && timingSafeStringEqual(provided as string, secret)
}

/**
 * Returns a 403 Response if the request should be rejected, or null if it's
 * safe to proceed. Call this before any other work (rate limiting, body
 * reads) on public pre-auth POST routes, mirroring the content-length check
 * that already runs first on those routes.
 */
export function verifyOriginProxy(req: { headers: Headers }): Response | null {
  const secret = process.env.ORIGIN_VERIFY_SECRET?.trim()
  if (!secret) return null // not configured yet — unenforced

  const provided = req.headers.get(ORIGIN_VERIFY_HEADER)
  if (!provided || !timingSafeStringEqual(provided, secret)) {
    return new Response('Forbidden', { status: 403 })
  }
  return null
}
