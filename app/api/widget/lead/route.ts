import { isAcceptableLeadEmail } from '@/lib/widget/lead-email-address'
import { after } from 'next/server'
import { getOrgByWidgetToken } from '@/lib/db/queries/widgets'
import { saveWidgetLead } from '@/lib/db/queries/widget-leads'
import { rateLimitShared } from '@/lib/ratelimit'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { clientIp } from '@/lib/http/client-ip'
import { verifyOriginProxy } from '@/lib/http/origin-guard'
import { verifyRenderToken } from '@/lib/widget/render-token'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'
import { isValidWidgetToken } from '@/lib/widget/request-validation'
import { verifyLeadQuestionToken } from '@/lib/widget/lead-question-token'
import { notifyNewWidgetLead } from '@/lib/widget/lead-notifications'

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

// The address is checked by isAcceptableLeadEmail (lib/widget/lead-email-address.ts):
// plain, ordinary addresses only. It lands in an email to the team and on the
// Leads page, so anything odd is refused here and never stored.

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

  let body: { widgetToken?: string; renderToken?: string; email?: string; questionToken?: string }
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { widgetToken, renderToken, email, questionToken } = body
  if (!isValidWidgetToken(widgetToken)) {
    return new Response('Missing widgetToken', { status: 400 })
  }
  // See app/api/widget/chat/route.ts and lib/widget/render-token.ts — same
  // binding to a render that passed the origin allowlist, same reason
  // (Known Issue 114).
  if (!verifyRenderToken(renderToken, widgetToken, ip)) {
    return new Response('Forbidden', { status: 403 })
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
  if (normalized.length > MAX_EMAIL_CHARS || !isAcceptableLeadEmail(normalized)) {
    return new Response('Invalid email', { status: 400 })
  }

  // Optional: the question the visitor couldn't get answered, attached by the
  // widget's on-failure prompt only — the up-front gate sends none. Never
  // taken as text from the caller: only from a token this server signed for a
  // real failed turn on this widget (lib/widget/lead-question-token.ts). A
  // missing, expired or invalid token is treated as simply absent rather than
  // a 400 — a lead missing its context is still a real lead worth saving.
  const verifiedQuestion = verifyLeadQuestionToken(questionToken, widgetToken) ?? undefined

  try {
    const org = await getOrgByWidgetToken(widgetToken)
    if (!org) return new Response('Invalid widget token', { status: 404 })

    const saved = await saveWidgetLead(org.id, widgetToken, normalized, verifiedQuestion)
    // Tell the team once, for a first submission only: a repeat from the same
    // address sends nothing. It runs after the response, so the visitor never
    // waits on the mail provider, and a problem there cannot fail their request.
    if (saved?.isNew) after(() => notifyNewWidgetLead(org.id))
    return Response.json({ ok: true })
  } catch (err) {
    logger.error('widget lead save failed', { module: MOD, requestId: getRequestId(request), widgetToken, error: err })
    return new Response('Internal server error', { status: 500 })
  }
}
