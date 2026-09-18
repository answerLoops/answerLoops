import { getOrgByWidgetToken } from '@/lib/db/queries/widgets'
import { saveWidgetLead } from '@/lib/db/queries/widget-leads'
import { rateLimitShared } from '@/lib/ratelimit'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { clientIp } from '@/lib/http/client-ip'
import { verifyOriginProxy } from '@/lib/http/origin-guard'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/widget/lead'

// This endpoint writes a row per call, so it carries the same abuse controls
// as widget chat next door: per-token and per-IP rate limits, a body cap, and
// a length-bounded email format check.
const IP_TOKEN_MAX = 5
const IP_TOKEN_WINDOW_MS = 60_000
const TOKEN_MAX = 30
const TOKEN_WINDOW_MS = 60_000

// A lead is one short email address. 64KB of headroom for the JSON envelope is
// already generous; the address itself is capped far tighter below.
const MAX_BODY_BYTES = 64 * 1024

// RFC 5321 caps a path at 254 characters. Anything longer is not an address.
const MAX_EMAIL_CHARS = 254

// Deliberately loose: one @, something either side, no whitespace, a dot in the
// domain. Stricter patterns reject valid addresses, and this is a lead capture
// box, not an identity system — the goal is to keep junk out of the table, not
// to prove deliverability.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/

// Same shape check as the chat route — see the note there. This route feeds the
// token straight into rate-limit bucket keys too, so it needs the same guard.
const WIDGET_TOKEN_PATTERN = /^[0-9a-f]{48}$/

export async function POST(request: Request) {
  // Must precede clientIp(), which trusts the proxy-supplied client-IP header —
  // see lib/http/origin-guard.ts. The chat route next door already did this;
  // this one did not, so its per-IP bucket was keyed on a value a caller
  // reaching the origin directly could choose. No-op until the secret is set.
  const originRejection = verifyOriginProxy(request)
  if (originRejection) return originRejection

  const ip = clientIp(request)

  const raw = await readBodyCapped(request, MAX_BODY_BYTES)
  if (raw === null) return new Response('Request body too large', { status: 413 })

  let body: { widgetToken?: string; email?: string }
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { widgetToken, email } = body
  if (!widgetToken || typeof widgetToken !== 'string' || !WIDGET_TOKEN_PATTERN.test(widgetToken)) {
    return new Response('Missing widgetToken', { status: 400 })
  }

  // Rate limit before resolving the token so an invalid-token flood costs a
  // limiter check rather than a database lookup per request.
  const tokenLimit = await rateLimitShared(`widget-lead-token:${widgetToken}`, TOKEN_MAX, TOKEN_WINDOW_MS)
  if (!tokenLimit.ok) return new Response('Too many requests', { status: 429 })

  const ipLimit = await rateLimitShared(
    `widget-lead-ip:${widgetToken}:${ip}`,
    IP_TOKEN_MAX,
    IP_TOKEN_WINDOW_MS
  )
  if (!ipLimit.ok) return new Response('Too many requests', { status: 429 })

  if (typeof email !== 'string') return new Response('Invalid email', { status: 400 })
  const normalized = email.trim().toLowerCase()
  if (normalized.length > MAX_EMAIL_CHARS || !EMAIL_PATTERN.test(normalized)) {
    return new Response('Invalid email', { status: 400 })
  }

  try {
    const org = await getOrgByWidgetToken(widgetToken)
    if (!org) return new Response('Invalid widget token', { status: 404 })

    // No origin allowlist here by design. This request is made from inside our
    // own iframe, so it is same-origin to us and its Origin header is our
    // hostname — the embedding page's identity is not present on it. The
    // allowlist is enforced at the iframe navigation instead (see
    // app/widget/[widgetToken]/page.tsx).

    await saveWidgetLead(org.id, widgetToken, normalized)
    return Response.json({ ok: true })
  } catch (err) {
    logger.error('widget lead save failed', { module: MOD, requestId: getRequestId(request), widgetToken, error: err })
    return new Response('Internal server error', { status: 500 })
  }
}
