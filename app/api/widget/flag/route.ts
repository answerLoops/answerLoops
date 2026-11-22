import { after } from 'next/server'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { getOrgByWidgetToken } from '@/lib/db/queries/widgets'
import { getWidgetLeadId, saveWidgetLead } from '@/lib/db/queries/widget-leads'
import {
  FLAG_REASONS,
  createAnswerFlag,
  getDownFlag,
  updateFlagDetails,
  type FlagReason,
  type FlagVerdict,
} from '@/lib/db/queries/widget-answer-flags'
import { rateLimitShared } from '@/lib/ratelimit'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { clientIp } from '@/lib/http/client-ip'
import { verifyOriginProxy } from '@/lib/http/origin-guard'
import { verifyRenderToken } from '@/lib/widget/render-token'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'
import { isValidWidgetToken } from '@/lib/widget/request-validation'
import { mintFlagToken, verifyAnswerToken, verifyFlagToken } from '@/lib/widget/answer-token'
import {
  MAX_FLAG_ANSWER_CHARS,
  MAX_FLAG_NOTE_CHARS,
  MAX_FLAG_QUESTION_CHARS,
  cleanFlagText,
} from '@/lib/widget/flag-text'
import { isAcceptableLeadEmail } from '@/lib/widget/lead-email-address'
import { notifyNewWidgetLead } from '@/lib/widget/lead-notifications'

const MOD = 'api/widget/flag'

// Each call writes a row, so this carries the same abuse controls as the lead
// route next door: per-token and per-IP rate limits, a body cap, and every
// stored value cleaned. A workspace also has a daily ceiling on flags
// (MAX_FLAGS_PER_DAY in lib/db/queries/widget-answer-flags.ts).
const IP_TOKEN_MAX = 10
const IP_TOKEN_WINDOW_MS = 60_000
const TOKEN_MAX = 60
const TOKEN_WINDOW_MS = 60_000

// A question, an answer, a note and an email, plus the JSON envelope.
const MAX_BODY_BYTES = 32 * 1024

const MAX_EMAIL_CHARS = 254

interface Prepared {
  body: Record<string, unknown>
  widgetToken: string
  ip: string
}

// Everything the two methods share, in the order the lead route does it: the
// proxy check before the client address is trusted, the body cap, the render
// token binding (lib/widget/render-token.ts), then rate limits before any
// database lookup.
async function prepare(request: Request): Promise<Prepared | Response> {
  const originRejection = verifyOriginProxy(request)
  if (originRejection) return originRejection

  const ip = clientIp(request)

  const raw = await readBodyCapped(request, MAX_BODY_BYTES)
  if (raw === null) return new Response('Request body too large', { status: 413 })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return new Response('Invalid JSON', { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { widgetToken, renderToken } = body
  if (!isValidWidgetToken(widgetToken)) return new Response('Missing widgetToken', { status: 400 })
  if (!verifyRenderToken(typeof renderToken === 'string' ? renderToken : undefined, widgetToken, ip)) {
    return new Response('Forbidden', { status: 403 })
  }

  const tokenLimit = await rateLimitShared(`widget-flag-token:${widgetToken}`, TOKEN_MAX, TOKEN_WINDOW_MS)
  if (!tokenLimit.ok) return new Response('Too many requests', { status: 429 })
  const ipLimit = await rateLimitShared(`widget-flag-ip:${widgetToken}:${ip}`, IP_TOKEN_MAX, IP_TOKEN_WINDOW_MS)
  if (!ipLimit.ok) return new Response('Too many requests', { status: 429 })

  return { body, widgetToken, ip }
}

/**
 * Creates a visitor's flag on one widget answer. The answer is named by a signed
 * answer token (lib/widget/answer-token.ts) that app/api/widget/lead-signal
 * minted for a turn that really produced it; the cited articles come from the
 * server's own record of that answer. Returns a flag token for adding a reason,
 * note or email to this flag with PATCH.
 */
export async function POST(request: Request) {
  const prepared = await prepare(request)
  if (prepared instanceof Response) return prepared
  const { body, widgetToken } = prepared

  const verdict = body.verdict
  if (verdict !== 'up' && verdict !== 'down') return new Response('Invalid verdict', { status: 400 })

  // The answer, its question and its reply all come from the signed token the
  // server minted for this turn. Text in the request body is never read.
  const answerRef = verifyAnswerToken(body.answerToken, widgetToken)
  if (!answerRef) return new Response('Invalid answer reference', { status: 400 })

  try {
    const org = await getOrgByWidgetToken(widgetToken)
    if (!org) return new Response('Invalid widget token', { status: 404 })
    if (!(await orgHasFeature(org.id, 'kb_review_queue'))) return new Response('Not available', { status: 403 })

    const outcome = await createAnswerFlag({
      orgId: org.id,
      answerId: answerRef.answerId,
      verdict: verdict as FlagVerdict,
      question: cleanFlagText(answerRef.question, MAX_FLAG_QUESTION_CHARS, false),
      answer: cleanFlagText(answerRef.answer, MAX_FLAG_ANSWER_CHARS, true),
    })
    if (!outcome.ok) {
      return outcome.reason === 'limit'
        ? new Response('Too many requests', { status: 429 })
        : new Response('Answer not found', { status: 404 })
    }
    return Response.json({ ok: true, flagToken: mintFlagToken(widgetToken, outcome.id) })
  } catch (err) {
    logger.error('widget flag create failed', { module: MOD, requestId: getRequestId(request), widgetToken, error: err })
    return new Response('Internal server error', { status: 500 })
  }
}

/**
 * Adds the visitor's reason, note and optionally an email to a flag they made,
 * named by the flag token POST returned. The email is only taken when the
 * workspace has email follow-up switched on, and goes through the same lead save
 * as the lead route; the flag keeps a link to the lead, not a copy of the address.
 */
export async function PATCH(request: Request) {
  const prepared = await prepare(request)
  if (prepared instanceof Response) return prepared
  const { body, widgetToken } = prepared

  const flagId = verifyFlagToken(body.flagToken, widgetToken)
  if (!flagId) return new Response('Invalid flag reference', { status: 400 })

  let reason: FlagReason | undefined
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== 'string' || !FLAG_REASONS.includes(body.reason as FlagReason)) {
      return new Response('Invalid reason', { status: 400 })
    }
    reason = body.reason as FlagReason
  }
  const note = body.note === undefined || body.note === null ? undefined : cleanFlagText(body.note, MAX_FLAG_NOTE_CHARS, true)

  let email: string | undefined
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (typeof body.email !== 'string') return new Response('Invalid email', { status: 400 })
    email = body.email.trim().toLowerCase()
    if (email.length > MAX_EMAIL_CHARS || !isAcceptableLeadEmail(email)) return new Response('Invalid email', { status: 400 })
  }

  try {
    const org = await getOrgByWidgetToken(widgetToken)
    if (!org) return new Response('Invalid widget token', { status: 404 })
    if (!(await orgHasFeature(org.id, 'kb_review_queue'))) return new Response('Not available', { status: 403 })

    const flag = await getDownFlag(flagId, org.id)
    if (!flag) return new Response('Flag not found', { status: 404 })

    let leadId: number | undefined
    if (email) {
      // The owner switched email follow-up off: the widget never shows the
      // field, so an address sent anyway is refused rather than quietly stored.
      if (org.widget_lead_capture_mode === 'off') return new Response('Email follow-up is not available', { status: 400 })
      // No question is attached: the lead keeps the flag link, and the lead
      // route's rule that a lead's question only ever comes from a signed
      // token minted for a failed turn stays true.
      const saved = await saveWidgetLead(org.id, widgetToken, email)
      if (saved?.isNew) after(() => notifyNewWidgetLead(org.id))
      leadId = (await getWidgetLeadId(org.id, email)) ?? undefined
    }

    await updateFlagDetails({
      id: flagId,
      orgId: org.id,
      ...(reason !== undefined && { reason }),
      ...(note !== undefined && { note }),
      ...(leadId !== undefined && { leadId }),
    })
    return Response.json({ ok: true })
  } catch (err) {
    logger.error('widget flag update failed', { module: MOD, requestId: getRequestId(request), widgetToken, error: err })
    return new Response('Internal server error', { status: 500 })
  }
}
