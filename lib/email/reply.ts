import { randomUUID } from 'node:crypto'
import { Resend } from 'resend'
import { getIntegration } from '@/lib/db/queries/integrations'
import { getEmailDomain } from '@/lib/db/queries/email-domains'
import { getEmailOauthConnection, markEmailOauthDisconnected } from '@/lib/db/queries/email-oauth'
import type { EmailOauthConnection } from '@/lib/db/queries/email-oauth'
import { getLatestInboundForTicket, recordOutboundEmail } from '@/lib/db/queries/email-messages'
import { collectThreadIds } from '@/lib/email/inbound'
import { getValidGmailAccessToken, sendGmail } from '@/lib/email/gmail'
import { getValidOutlookAccessToken, sendOutlook } from '@/lib/email/outlook'
import { notifyAdminsOauthDisconnected } from '@/lib/email/send'
import { logger } from '@/lib/logger'

const MOD = 'email/reply'
const DEFAULT_DOMAIN = 'inbox.answerloops.app'

function newMessageId(domain: string): string {
  return `<${randomUUID()}@${domain}>`
}

type Thread = Awaited<ReturnType<typeof getLatestInboundForTicket>>

function buildThreadingHeaders(fromDomain: string, thread: Thread) {
  const rfcMessageId = newMessageId(fromDomain)
  const headers: Record<string, string> = { 'Message-ID': rfcMessageId }
  let references: string | null = null
  if (thread) {
    const priorRefs = collectThreadIds(thread.in_reply_to, thread.references)
    references = [...priorRefs, thread.rfc_message_id].join(' ')
    headers['In-Reply-To'] = thread.rfc_message_id
    headers['References'] = references
  }
  return { rfcMessageId, headers, references }
}

// channelId for email = "{toAddress}|{messageId}" — legacy fallback only, used
// when there's no ticketId (or no recorded inbound thread) to resolve from.
const SIMPLE_EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

export async function sendEmailReply(
  channelId: string,
  content: string,
  orgId: number,
  ticketId?: number
): Promise<string | null> {
  const [fallbackToAddress] = channelId.split('|')

  // Replies are only sent for orgs that have connected their own email channel.
  const integration = await getIntegration(orgId, 'email')
  if (!integration || integration.enabled !== 1) {
    logger.warn('no connected email integration for this org — skipping reply', { module: MOD, orgId })
    return null
  }

  const thread = ticketId ? await getLatestInboundForTicket(ticketId, orgId) : null
  const toAddress = thread?.from_addr ?? fallbackToAddress
  if (!toAddress || !SIMPLE_EMAIL_RE.test(toAddress)) return null

  const subjectBase = thread?.subject?.replace(/^\s*re:\s*/i, '').trim() || 'Your support request'
  const subject = `Re: ${subjectBase}`

  // Try the org's connected OAuth mailbox (Gmail or Outlook) first when
  // configured — never silently drops the reply on failure (dead refresh
  // token, provider API error), it falls through to the platform Resend
  // address below instead.
  if (integration?.email_send_method === 'oauth') {
    const connection = await getEmailOauthConnection(orgId)
    if (connection?.status === 'connected') {
      const sent =
        connection.provider === 'outlook'
          ? await sendViaOutlook(connection, toAddress, subject, content, thread, orgId, ticketId)
          : await sendViaGmail(connection, toAddress, subject, content, thread, orgId, ticketId)
      if (sent) return sent
    } else {
      logger.warn('email_send_method is oauth but no connected mailbox — falling back', { module: MOD, orgId })
    }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    logger.warn('RESEND_API_KEY not set — cannot send email reply', { module: MOD, orgId })
    return null
  }

  let fromAddress: string
  if (integration?.email_send_method === 'domain') {
    const domainRow = await getEmailDomain(orgId)
    if (domainRow?.status === 'verified') {
      fromAddress = `noreply@${domainRow.domain}`
    } else {
      logger.warn('email_send_method is domain but domain is not verified — falling back', {
        module: MOD,
        orgId,
      })
      fromAddress = process.env.RESEND_FROM ?? 'support@yourdomain.com'
    }
  } else {
    fromAddress = process.env.RESEND_FROM ?? 'support@yourdomain.com'
  }
  const fromDomain = fromAddress.split('@')[1] ?? DEFAULT_DOMAIN
  const { rfcMessageId, headers, references } = buildThreadingHeaders(fromDomain, thread)

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [toAddress],
      subject,
      text: content,
      headers,
    })

    if (error) {
      logger.error('Resend reply failed', { module: MOD, orgId, ticketId, error })
      return null
    }

    if (ticketId) {
      await recordOutboundEmail({
        orgId,
        rfcMessageId,
        providerMessageId: data?.id ?? null,
        inReplyTo: thread?.rfc_message_id ?? null,
        references,
        ticketId,
        fromAddr: fromAddress,
        toAddr: toAddress,
        subject,
      })
    }

    return rfcMessageId
  } catch (err) {
    logger.error('email reply threw', { module: MOD, orgId, ticketId, error: err })
    return null
  }
}

async function sendViaGmail(
  connection: EmailOauthConnection,
  toAddress: string,
  subject: string,
  content: string,
  thread: Thread,
  orgId: number,
  ticketId?: number
): Promise<string | null> {
  const token = await getValidGmailAccessToken(connection)
  if (typeof token !== 'string') {
    await markEmailOauthDisconnected(orgId)
    await notifyAdminsOauthDisconnected(orgId, 'gmail')
    logger.warn('Gmail reauth required — falling back to platform address', { module: MOD, orgId })
    return null
  }

  const fromDomain = connection.mailbox_address.split('@')[1] ?? DEFAULT_DOMAIN
  const { rfcMessageId, headers, references } = buildThreadingHeaders(fromDomain, thread)

  const result = await sendGmail(token, {
    to: toAddress,
    from: connection.mailbox_address,
    subject,
    text: content,
    headers,
  })
  if ('error' in result) {
    logger.error('Gmail reply failed', { module: MOD, orgId, ticketId, error: result.error })
    return null
  }

  if (ticketId) {
    await recordOutboundEmail({
      orgId,
      rfcMessageId,
      providerMessageId: null,
      inReplyTo: thread?.rfc_message_id ?? null,
      references,
      ticketId,
      fromAddr: connection.mailbox_address,
      toAddr: toAddress,
      subject,
    })
  }

  return rfcMessageId
}

// Outlook (Microsoft Graph) can't mint its own Message-ID client-side the
// way Resend/Gmail do — it can only set In-Reply-To (via a MAPI extended
// property, best-effort) and has no way to carry References at all. The
// real RFC Message-ID is read back from Graph after sending and used as
// rfcMessageId, same role Resend's/Gmail's minted id plays elsewhere.
async function sendViaOutlook(
  connection: EmailOauthConnection,
  toAddress: string,
  subject: string,
  content: string,
  thread: Thread,
  orgId: number,
  ticketId?: number
): Promise<string | null> {
  const token = await getValidOutlookAccessToken(connection)
  if (typeof token !== 'string') {
    await markEmailOauthDisconnected(orgId)
    await notifyAdminsOauthDisconnected(orgId, 'outlook')
    logger.warn('Outlook reauth required — falling back to platform address', { module: MOD, orgId })
    return null
  }

  const result = await sendOutlook(token, {
    to: toAddress,
    from: connection.mailbox_address,
    subject,
    text: content,
    inReplyTo: thread?.rfc_message_id,
  })
  if ('error' in result) {
    logger.error('Outlook reply failed', { module: MOD, orgId, ticketId, error: result.error })
    return null
  }

  if (ticketId) {
    await recordOutboundEmail({
      orgId,
      rfcMessageId: result.rfcMessageId,
      providerMessageId: result.providerMessageId,
      inReplyTo: thread?.rfc_message_id ?? null,
      references: null,
      ticketId,
      fromAddr: connection.mailbox_address,
      toAddr: toAddress,
      subject,
    })
  }

  return result.rfcMessageId
}
