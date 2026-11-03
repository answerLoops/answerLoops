import { getLeadSignal } from '@/lib/widget/lead-signal-stash'
import { mintLeadQuestionToken } from '@/lib/widget/lead-question-token'
import { rateLimitShared } from '@/lib/ratelimit'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { clientIp } from '@/lib/http/client-ip'
import { verifyOriginProxy } from '@/lib/http/origin-guard'
import { verifyRenderToken } from '@/lib/widget/render-token'
import { isValidWidgetToken, isValidVisitorId, isValidTurnId } from '@/lib/widget/request-validation'

/**
 * "Did the turn I just sent fail?" — called by the widget client right after
 * a chat turn finishes, when the org's lead-capture mode is 'on-failure' (see
 * lib/widget/lead-capture.ts). The actual signal was computed and stashed by
 * app/api/widget/chat/route.ts's onFinish; this route only reads it back, so
 * it does no model or KB work of its own and is cheap to rate-limit tightly.
 */

// Same per-token/per-IP shape as the chat and lead routes next door, scaled
// down: one lookup per real chat turn, never more.
const IP_TOKEN_MAX = 20
const IP_TOKEN_WINDOW_MS = 60_000
const TOKEN_MAX = 100
const TOKEN_WINDOW_MS = 60_000

// Body is just {widgetToken, renderToken, visitorId, turnId} — four short strings.
const MAX_BODY_BYTES = 4 * 1024

export async function POST(request: Request) {
  const originRejection = verifyOriginProxy(request)
  if (originRejection) return originRejection

  const ip = clientIp(request)

  const raw = await readBodyCapped(request, MAX_BODY_BYTES)
  if (raw === null) return new Response('Request body too large', { status: 413 })

  let body: { widgetToken?: string; renderToken?: string; visitorId?: string; turnId?: string }
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { widgetToken, renderToken, visitorId, turnId } = body
  if (!isValidWidgetToken(widgetToken)) {
    return new Response('Missing widgetToken', { status: 400 })
  }
  // Same binding as the chat and lead routes — see lib/widget/render-token.ts
  // and Known Issue 114. This route reveals nothing about a *different*
  // visitor's conversation (the lookup is scoped by visitorId below too), but
  // an unauthenticated caller still shouldn't be able to probe whether an
  // arbitrary org's widget is mid-failure without having passed the origin
  // allowlist first.
  if (!verifyRenderToken(renderToken, widgetToken, ip)) {
    return new Response('Forbidden', { status: 403 })
  }
  if (!isValidVisitorId(visitorId)) {
    return new Response('Missing visitorId', { status: 400 })
  }
  if (!isValidTurnId(turnId)) {
    return new Response('Missing turnId', { status: 400 })
  }

  const tokenLimit = await rateLimitShared(`widget-lead-signal-token:${widgetToken}`, TOKEN_MAX, TOKEN_WINDOW_MS)
  if (!tokenLimit.ok) return new Response('Too many requests', { status: 429 })

  const ipLimit = await rateLimitShared(
    `widget-lead-signal-ip:${widgetToken}:${ip}`,
    IP_TOKEN_MAX,
    IP_TOKEN_WINDOW_MS
  )
  if (!ipLimit.ok) return new Response('Too many requests', { status: 429 })

  // No org lookup: the stash is keyed by widgetToken (see
  // lib/widget/lead-signal-stash.ts), and this route does nothing with the
  // org itself — a stale/revoked token just reads back 'none', same as a
  // token with no stashed signal at all.
  const { signal, question } = getLeadSignal(widgetToken, visitorId, turnId)
  // For a failed turn, also hands back a signed copy of the question the
  // server recorded, which the widget returns with the visitor's email so the
  // saved lead carries that exact question — see lib/widget/lead-question-token.ts.
  const questionToken = signal === 'none' ? null : mintLeadQuestionToken(widgetToken, question)
  return Response.json({ signal, ...(questionToken ? { questionToken } : {}) })
}
