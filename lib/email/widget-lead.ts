import { Resend } from 'resend'
import { escapeHtml } from '@/lib/email/send'
import { isAcceptableLeadEmail } from '@/lib/widget/lead-email-address'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { appOrigin } from '@/lib/site'
import { logger } from '@/lib/logger'

const MOD = 'email/widget-lead'

/** The email a workspace's team gets when visitors leave their address in the website chat. */
export interface WidgetLeadEmailLead {
  email: string
  question: string | null
}

export interface WidgetLeadEmailInput {
  /** The leads to list, oldest first. */
  leads: WidgetLeadEmailLead[]
  /** How many more leads there are beyond the ones listed. */
  moreCount: number
  /** Where the button lands: the workspace's Leads page. */
  leadsUrl: string
}

// A question is one visitor sentence; a long one is cut so a single lead cannot
// make the email long.
const QUESTION_MAX_CHARS = 300

// An address that does not pass the lead check (one saved before the check
// existed, say) is never shown in an email; the lead stays on the Leads page.
const OMITTED_ADDRESS = '(address not shown: it did not look like a normal email address)'
const shownAddress = (value: string) => (isAcceptableLeadEmail(value) ? value : OMITTED_ADDRESS)

// Printed in every lead email: what the visitor typed has not been checked.
const VISITOR_TEXT_NOTE =
  'The address and question above were typed by the visitor and have not been verified. Treat any links or requests in them with care.'

const BASE_STYLE = 'font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px'
const MUTED = 'color:#6b7280;font-size:14px'

function shorten(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The subject, HTML and plain text of the email. The subject is fixed wording
 * (with only a count in it): nothing a visitor typed appears in it. Everything
 * a visitor typed, the address and the question, is escaped in the HTML part
 * and used as plain text in the text part. Pure, so it is tested directly.
 */
export function renderWidgetLeadEmail(input: WidgetLeadEmailInput): { subject: string; html: string; text: string } {
  const total = input.leads.length + input.moreCount
  const single = total === 1
  const subject = single ? 'New lead from your website chat' : `${total} new leads from your website chat`
  const headline = single
    ? 'A visitor left their email in your website chat.'
    : `${total} visitors left their email in your website chat.`

  const itemsHtml = input.leads
    .map((lead) => {
      const question = lead.question ? shorten(lead.question, QUESTION_MAX_CHARS) : null
      return `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px">
          <p style="margin:0;font-size:15px;font-weight:600;color:#111827">${escapeHtml(shownAddress(lead.email))}</p>
          ${
            question
              ? `<p style="${MUTED};margin:6px 0 0"><strong>Question the chat could not answer:</strong> ${escapeHtml(question)}</p>`
              : `<p style="${MUTED};margin:6px 0 0">Left their email before asking a question.</p>`
          }
        </div>`
    })
    .join('')
  const moreHtml =
    input.moreCount > 0
      ? `<p style="${MUTED};margin:0 0 16px">+${input.moreCount} more on your Leads page.</p>`
      : ''

  const html = `
    <div style="${BASE_STYLE}">
      <h2 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 16px">${headline}</h2>
      ${itemsHtml}
      ${moreHtml}
      <p style="${MUTED};margin:0 0 16px;font-size:13px">${escapeHtml(VISITOR_TEXT_NOTE)}</p>
      <a href="${escapeHtml(input.leadsUrl)}"
         style="display:inline-block;background:#111827;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none">
        Open your leads
      </a>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">${escapeHtml(input.leadsUrl)}</p>
    </div>
  `

  const textLines = input.leads.map((lead) => {
    const question = lead.question ? shorten(lead.question, QUESTION_MAX_CHARS) : null
    return question
      ? `- ${shownAddress(lead.email)}\n  Question the chat could not answer: ${question}`
      : `- ${shownAddress(lead.email)}\n  Left their email before asking a question.`
  })
  const text = [
    headline,
    '',
    ...textLines,
    ...(input.moreCount > 0 ? ['', `+${input.moreCount} more on your Leads page.`] : []),
    '',
    VISITOR_TEXT_NOTE,
    '',
    `Open your leads: ${input.leadsUrl}`,
  ].join('\n')

  return { subject, html, text }
}

/** Where the Leads page lives, on the app's own address. */
export function leadsPageUrl(): string {
  const base = appOrigin() ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  return `${base.replace(/\/+$/, '')}/leads`
}

/** Whether this deployment can send email at all (no mail service on a plain self-hosted install). */
export function emailServiceConfigured(): boolean {
  return !MOCK_EXTERNALS && !!process.env.RESEND_API_KEY
}

/**
 * Sends the lead email to the team. Returns whether the mail provider accepted
 * it, so the caller can leave the leads waiting for the next email when it did
 * not. Never throws. There is no Reply-To: replying would reach nobody useful,
 * and the visitor is never an addressee.
 */
export async function sendWidgetLeadEmail(to: string[], input: WidgetLeadEmailInput): Promise<boolean> {
  if (!emailServiceConfigured() || to.length === 0) return false
  const { subject, html, text } = renderWidgetLeadEmail(input)
  try {
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.RESEND_FROM ?? 'notifications@yourdomain.com',
      to,
      subject,
      html,
      text,
    })
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      logger.error('widget lead email was not accepted', { module: MOD, error: result.error })
      return false
    }
    return true
  } catch (error) {
    logger.error('widget lead email failed', { module: MOD, error })
    return false
  }
}
