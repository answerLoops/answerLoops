import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import {
  getIntegrationByBotSecret,
  getIntegration,
  parseChannelIds,
} from '@/lib/db/queries/integrations'
import { getEmailDomainByDomain } from '@/lib/db/queries/email-domains'
import { processCommunityMessage } from '@/lib/ingest/pipeline'
import { recordCustomerReply, getTicketById } from '@/lib/db/queries/tickets'
import { createNotification } from '@/lib/db/queries/notifications'
import {
  recordInboundEmail,
  updateEmailMessageStatus,
  setEmailMessageTicket,
  findTicketByMessageIds,
  countRecentOutboundToSender,
  markStatusByProviderMessageId,
  type EmailMessageStatus,
} from '@/lib/db/queries/email-messages'
import { verifyResendWebhook } from '@/lib/email/webhook-verify'
import {
  normalizeHeaders,
  detectAutoResponse,
  extractSpamVerdict,
  htmlToText,
  canonicalMessageId,
  collectThreadIds,
} from '@/lib/email/inbound'
import { rateLimit } from '@/lib/ratelimit'
import { logger } from '@/lib/logger'

const MOD = 'api/email/ingest'
const MAX_BODY_BYTES = 2_000_000
const REPLY_THROTTLE_WINDOW_MS = 60 * 60 * 1000
const REPLY_THROTTLE_MAX = 5

// Strips quoted reply chains ("On ... wrote:") from email body text.
function stripQuotedReplies(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join('\n')
    .replace(/\nOn [\s\S]+?wrote:\s*$/, '')
    .trim()
}

// Normalise sender: "Jane Smith <jane@example.com>" → { name, email }
function parseSender(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/)
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() }
  return { name: from.trim(), email: from.trim().toLowerCase() }
}

// Resend's outbound delivery-status webhooks reference their own internal id
// (not our RFC Message-ID) — that's why outbound sends persist provider_message_id.
async function handleDeliveryEvent(eventType: string, data: Record<string, unknown>): Promise<void> {
  const providerMessageId = String(data['email_id'] ?? data['id'] ?? '')
  if (!providerMessageId) return

  const status: EmailMessageStatus =
    eventType === 'email.bounced'
      ? 'bounced'
      : eventType === 'email.complained'
        ? 'rejected_spam'
        : 'delivery_failed'

  await markStatusByProviderMessageId(providerMessageId, status)
  logger.info('outbound delivery status updated', { module: MOD, eventType, providerMessageId, status })
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return new Response('Payload Too Large', { status: 413 })
  }

  const resendSecret = process.env.RESEND_WEBHOOK_SECRET
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  const isResendWebhook = !!(resendSecret && svixId && svixSignature)

  let orgId: number
  let integration: Awaited<ReturnType<typeof getIntegration>>
  let data: Record<string, unknown>
  let headersRaw: unknown

  if (isResendWebhook) {
    const rawBody = await req.text()
    if (rawBody.length > MAX_BODY_BYTES) {
      return new Response('Payload Too Large', { status: 413 })
    }
    if (!verifyResendWebhook(rawBody, { id: svixId, timestamp: svixTimestamp, signature: svixSignature }, resendSecret!)) {
      logger.warn('resend webhook signature invalid', { module: MOD })
      return new Response('Unauthorized', { status: 401 })
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    const eventType = String(parsed['type'] ?? '')
    const eventData = (parsed['data'] ?? {}) as Record<string, unknown>

    if (eventType && eventType.startsWith('email.') && eventType !== 'email.received') {
      await handleDeliveryEvent(eventType, eventData)
      return Response.json({ ok: true })
    }

    if (eventType !== 'email.received') return Response.json({ ok: true })

    const recipientList = Array.isArray(eventData['to']) ? eventData['to'].map(String) : []
    const recipient = recipientList[0] ?? ''
    const recipientDomain = recipient.includes('@') ? recipient.split('@').pop()!.toLowerCase() : ''
    const domain = recipientDomain ? await getEmailDomainByDomain(recipientDomain) : null
    if (!domain || domain.status !== 'verified') {
      logger.warn('received email has no verified answerLoops domain', { module: MOD, recipientDomain })
      return Response.json({ ok: true })
    }

    const emailId = String(eventData['email_id'] ?? '')
    const apiKey = process.env.RESEND_API_KEY
    if (!emailId || !apiKey) return new Response('Unable to retrieve received email', { status: 503 })

    const { data: received, error: receiveError } = await new Resend(apiKey).emails.receiving.get(emailId)
    if (receiveError || !received) {
      logger.error('failed to retrieve received email from Resend', {
        module: MOD,
        emailId,
        error: receiveError && typeof receiveError === 'object'
          ? { name: 'name' in receiveError ? receiveError.name : undefined, message: 'message' in receiveError ? receiveError.message : undefined }
          : receiveError,
      })
      return new Response('Unable to retrieve received email', { status: 502 })
    }

    orgId = domain.org_id
    integration = await getIntegration(orgId, 'email')
    if (!integration || integration.enabled !== 1) return Response.json({ ok: true })
    data = {
      from: received.from,
      to: received.to,
      subject: received.subject,
      text: received.text ?? '',
      html: received.html ?? '',
      message_id: received.message_id,
      headers: received.headers ?? {},
    }
    headersRaw = received.headers ?? {}
  } else {
    // Legacy BYO-provider path: shared secret header (SendGrid, Mailgun, Postmark, etc).
    const secret = req.headers.get('x-email-webhook-secret')
    if (!secret) {
      logger.warn('email ingest received without secret', { module: MOD })
      return new Response('Unauthorized', { status: 401 })
    }
    const matched = await getIntegrationByBotSecret(secret)
    if (!matched || matched.platform !== 'email') {
      logger.warn('email ingest secret did not match any org', { module: MOD })
      return new Response('Unauthorized', { status: 401 })
    }
    integration = matched
    orgId = integration.org_id

    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      try {
        data = (await req.json()) as Record<string, unknown>
      } catch {
        return new Response('Bad Request', { status: 400 })
      }
    } else {
      const fd = await req.formData()
      data = Object.fromEntries(fd.entries())
    }
    headersRaw = data['headers'] ?? null
  }

  // Per-org rate limit — a compromised/misbehaving upstream account shouldn't
  // be able to burn this org's LLM spend or bury the ticket queue.
  const rl = rateLimit(`email-ingest:${orgId}`, 60, 60_000)
  if (!rl.ok) {
    logger.warn('email ingest rate limited', { module: MOD, orgId })
    return new Response('Too Many Requests', { status: 429 })
  }

  const rawFrom = String(data['from'] ?? data['From'] ?? '')
  const rawTo = data['to'] ?? data['To'] ?? ''
  const toAddress = Array.isArray(rawTo) ? String(rawTo[0] ?? '') : String(rawTo)
  const subject = String(data['subject'] ?? data['Subject'] ?? '(no subject)')
  const rawText = String(data['text'] ?? data['Text'] ?? data['plain'] ?? '')
  const rawHtml = String(data['html'] ?? data['Html'] ?? '')
  const providerMessageId = String(data['message_id'] ?? data['Message-ID'] ?? data['id'] ?? '')

  if (!rawFrom) {
    logger.warn('email ingest missing from field', { module: MOD, orgId })
    return Response.json({ ok: false, error: 'missing from' }, { status: 400 })
  }

  const { name: senderName, email: senderEmail } = parseSender(rawFrom)
  const headers = normalizeHeaders(headersRaw)

  // Real RFC Message-ID: prefer the header (what the customer's client will
  // reference in In-Reply-To on their next reply), fall back to the provider id.
  const rfcMessageId = canonicalMessageId(
    headers.get('message-id') || providerMessageId || `${Date.now()}.${senderEmail}@inbound.local`
  )
  const inReplyToHeader = headers.get('in-reply-to')
  const referencesHeader = headers.get('references')

  // --- Guard chain: loop detection first — never persist/reply to a loop. ---
  const loopReason = detectAutoResponse(headers, senderEmail)
  if (loopReason) {
    logger.info('inbound email rejected: loop guard', { module: MOD, orgId, senderEmail, reason: loopReason })
    const rec = await recordInboundEmail({
      orgId,
      rfcMessageId,
      inReplyTo: inReplyToHeader,
      references: referencesHeader,
      fromAddr: senderEmail,
      toAddr: toAddress || undefined,
      subject,
      rawPayload: data,
    })
    if (rec) await updateEmailMessageStatus(rec.id, 'rejected_loop')
    return Response.json({ ok: true })
  }

  const spamVerdict = extractSpamVerdict(headers, data)

  // Idempotency gate — must happen before any expensive work. A provider
  // retry lands here and is dropped by the unique constraint on rfc_message_id.
  const recorded = await recordInboundEmail({
    orgId,
    rfcMessageId,
    inReplyTo: inReplyToHeader,
    references: referencesHeader,
    fromAddr: senderEmail,
    toAddr: toAddress || undefined,
    subject,
    spamVerdict,
    rawPayload: data,
  })
  if (!recorded) {
    logger.debug('duplicate inbound email — already recorded', { module: MOD, orgId, rfcMessageId })
    return Response.json({ ok: true })
  }

  if (spamVerdict) {
    logger.info('inbound email rejected: spam', { module: MOD, orgId, senderEmail, spamVerdict })
    await updateEmailMessageStatus(recorded.id, 'rejected_spam')
    return Response.json({ ok: true })
  }

  const allowedSenders = parseChannelIds(integration) // optional sender filter
  if (allowedSenders.length > 0) {
    const allowed = allowedSenders.some((s) => senderEmail === s || senderEmail.endsWith(`@${s}`))
    if (!allowed) {
      logger.debug('email from non-monitored sender — skipping', { module: MOD, orgId, senderEmail })
      await updateEmailMessageStatus(recorded.id, 'rejected_filter')
      return Response.json({ ok: true })
    }
  }

  // Backstop throttle: cap automated replies to a single sender per window,
  // in case a loop slips past header-based detection.
  const sinceIso = new Date(Date.now() - REPLY_THROTTLE_WINDOW_MS).toISOString()
  const recentReplies = await countRecentOutboundToSender(orgId, senderEmail, sinceIso)
  if (recentReplies >= REPLY_THROTTLE_MAX) {
    logger.warn('reply throttle exceeded — dropping to avoid mail loop', {
      module: MOD,
      orgId,
      senderEmail,
      recentReplies,
    })
    await updateEmailMessageStatus(recorded.id, 'rejected_filter')
    return Response.json({ ok: true })
  }

  const bodyText = rawText.trim() ? rawText : rawHtml ? htmlToText(rawHtml) : ''
  const cleanText = stripQuotedReplies(bodyText)
  const content = subject !== '(no subject)' ? `${subject}\n\n${cleanText}` : cleanText

  if (content.trim().length < 10) {
    await updateEmailMessageStatus(recorded.id, 'processed')
    return Response.json({ ok: true })
  }

  // Threading: does this reply belong to a ticket we already have open?
  const threadIds = collectThreadIds(inReplyToHeader, referencesHeader)
  const existingTicketId = threadIds.length > 0 ? await findTicketByMessageIds(threadIds, orgId) : null

  if (existingTicketId) {
    // Deliberately does NOT re-run the AI agent here — auto-replying to a
    // reply is exactly the shape of a mail loop, and the loop-guard headers
    // above don't catch every case. A staff notification keeps the loop-risk
    // surface minimal; a human decides whether an automated reply is safe.
    await recordCustomerReply(existingTicketId, cleanText || content)
    await setEmailMessageTicket(recorded.id, existingTicketId)
    await updateEmailMessageStatus(recorded.id, 'processed')
    const existingTicket = await getTicketById(existingTicketId, orgId)
    await createNotification(
      'new_question',
      `Customer replied to ticket #${existingTicket?.org_ticket_number ?? existingTicketId} — ${senderEmail}`,
      existingTicketId,
      orgId
    )
    logger.info('inbound email appended to existing ticket', { module: MOD, orgId, ticketId: existingTicketId })
    return Response.json({ ok: true })
  }

  logger.info('email ingest received', { module: MOD, orgId, senderEmail, subject })

  const result = await processCommunityMessage(
    {
      messageId: rfcMessageId,
      content,
      authorId: senderEmail,
      authorName: senderName,
      channelId: `${senderEmail}|${rfcMessageId}`,
      platform: 'email',
    },
    orgId
  )

  await setEmailMessageTicket(recorded.id, result.ticket_id)
  await updateEmailMessageStatus(recorded.id, 'processed')

  return Response.json({ ok: true })
}
