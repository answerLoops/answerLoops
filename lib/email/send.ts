import { Resend } from 'resend'
import { getOrgMembers } from '@/lib/db/queries/members'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import type { Ticket } from '@/types'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'
import { GITHUB_URL } from '@/lib/site'

function client() {
  return new Resend(process.env.RESEND_API_KEY)
}

function from() {
  return process.env.RESEND_FROM ?? 'notifications@yourdomain.com'
}

async function getAdminEmails(orgId: number): Promise<string[]> {
  const members = await getOrgMembers(orgId)
  return members
    .filter((m) => m.email && ['owner', 'admin'].includes(m.role))
    .map((m) => m.email as string)
}

export const SUPPORT_EMAIL = 'support@answerloops.com'

const BASE_STYLE = `font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px`
const MUTED = `color:#6b7280;font-size:14px`
const BADGE: Record<string, string> = {
  critical: 'background:#fee2e2;color:#991b1b',
  high: 'background:#ffedd5;color:#9a3412',
  medium: 'background:#fef9c3;color:#854d0e',
  low: 'background:#f0fdf4;color:#166534',
}

function priorityBadge(priority: string) {
  const style = BADGE[priority] ?? 'background:#f3f4f6;color:#374151'
  return `<span style="${style};font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;text-transform:uppercase">${priority}</span>`
}

function ticketLink(orgTicketNumber: number) {
  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  return `${base}/tickets/${orgTicketNumber}`
}

function emailSummary(content: string): string {
  const { text, attachments } = parseAttachmentLines(content)
  return text.slice(0, 120) || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
}

export async function sendNewTicketEmail(ticket: Ticket, orgId: number): Promise<void> {
  if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) return
  if (!['critical', 'high'].includes(ticket.priority)) return

  const to = await getAdminEmails(orgId)
  if (to.length === 0) return

  const summary = ticket.ai_summary ?? emailSummary(ticket.content)
  const author = ticket.source_author_name ?? 'Community member'
  const url = ticketLink(ticket.org_ticket_number)

  await client().emails.send({
    from: from(),
    to,
    subject: `[${ticket.priority.toUpperCase()}] New ticket #${ticket.org_ticket_number}: ${summary.slice(0, 60)}`,
    html: `
      <div style="${BASE_STYLE}">
        <p style="margin-bottom:4px">${priorityBadge(ticket.priority)}</p>
        <h2 style="font-size:18px;font-weight:600;color:#111827;margin:8px 0">
          New community ticket #${ticket.org_ticket_number}
        </h2>
        <p style="${MUTED};margin-bottom:4px"><strong>From:</strong> ${author}</p>
        <p style="${MUTED};margin-bottom:16px"><strong>Summary:</strong> ${summary}</p>
        <a href="${url}"
           style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none">
          View ticket
        </a>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">${url}</p>
      </div>
    `,
  })
}

export async function sendTicketResolvedEmail(
  ticket: Ticket,
  resolvedBy: string,
  orgId: number
): Promise<void> {
  if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) return

  const to = await getAdminEmails(orgId)
  if (to.length === 0) return

  const summary = ticket.ai_summary ?? emailSummary(ticket.content)
  const url = ticketLink(ticket.org_ticket_number)

  await client().emails.send({
    from: from(),
    to,
    subject: `Ticket #${ticket.org_ticket_number} resolved by ${resolvedBy}`,
    html: `
      <div style="${BASE_STYLE}">
        <h2 style="font-size:18px;font-weight:600;color:#111827;margin-bottom:8px">
          Ticket #${ticket.org_ticket_number} resolved
        </h2>
        <p style="${MUTED};margin-bottom:4px"><strong>Resolved by:</strong> ${resolvedBy}</p>
        <p style="${MUTED};margin-bottom:4px"><strong>Summary:</strong> ${summary}</p>
        ${ticket.resolution_notes ? `<p style="${MUTED};margin-bottom:16px"><strong>Notes:</strong> ${ticket.resolution_notes}</p>` : '<p style="margin-bottom:16px"></p>'}
        <a href="${url}"
           style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none">
          View ticket
        </a>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">${url}</p>
      </div>
    `,
  })
}

export async function sendWaitlistConfirmation(email: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return

  const from = process.env.RESEND_WAITLIST_FROM ?? process.env.RESEND_FROM ?? 'hello@answerloops.com'

  const result = await client().emails.send({
    from,
    to: [email],
    subject: "You're on the answerLoops waitlist",
    html: `
      <div style="${BASE_STYLE}">
        <img src="https://answerloops.com/logo.png" alt="answerLoops" style="height:48px;margin-bottom:24px" />
        <h2 style="font-size:20px;font-weight:700;color:#111827;margin-bottom:8px">
          You're on the list.
        </h2>
        <p style="${MUTED};margin-bottom:16px">
          Thanks for your interest in answerLoops — AI support that lives in your community.
          We'll email you the moment we open early access.
        </p>
        <p style="${MUTED};margin-bottom:24px">
          In the meantime, you can self-host the open-source version right now:
        </p>
        <a href="${GITHUB_URL}"
           style="display:inline-block;background:#111827;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none">
          View on GitHub
        </a>
        <p style="color:#9ca3af;font-size:12px;margin-top:32px">
          You're receiving this because you signed up at answerloops.com.
          No further emails until we launch.
        </p>
      </div>
    `,
  })
}

/**
 * Sent once, when a workspace is first created.
 *
 * Deliberately not sent on every sign-in: provisionUser only reaches this after
 * creating the org, so a returning user who already has a membership never gets
 * it again.
 *
 * Never throws. The caller is the sign-in path, and a transactional email
 * failing is not a reason to fail somebody's signup — they would be left with
 * an account they cannot get into because a mail provider had a bad minute.
 */
export async function sendWelcomeEmail(email: string, name: string | null): Promise<void> {
  if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) return

  const fromAddress = process.env.RESEND_FROM ?? 'hello@answerloops.com'
  const greeting = name?.trim() ? `Welcome, ${name.trim().split(/\s+/)[0]}.` : 'Welcome.'
  const dashboard = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'https://app.answerloops.com'

  try {
    await client().emails.send({
      from: fromAddress,
      to: [email],
      replyTo: SUPPORT_EMAIL,
      subject: 'Welcome to answerLoops',
      html: `
        <div style="${BASE_STYLE}">
          <img src="https://answerloops.com/logo.png" alt="answerLoops" style="height:48px;margin-bottom:24px" />
          <h2 style="font-size:20px;font-weight:700;color:#111827;margin-bottom:8px">
            ${greeting}
          </h2>
          <p style="${MUTED};margin-bottom:16px">
            Thanks for signing up. answerLoops answers the repeat questions your
            community keeps asking, so your team can spend its time on the ones
            that actually need a person.
          </p>
          <p style="${MUTED};margin-bottom:24px">
            The quickest start is to connect one channel and point us at your
            docs — the knowledge base builds itself from there.
          </p>
          <a href="${dashboard}/dashboard"
             style="display:inline-block;background:#111827;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none">
            Open your dashboard
          </a>
          <p style="${MUTED};margin-top:24px">
            Questions, or something not working the way you expected? Reply to
            this email or write to
            <a href="mailto:${SUPPORT_EMAIL}" style="color:#2563eb">${SUPPORT_EMAIL}</a>
            — a person reads it.
          </p>
          <p style="color:#9ca3af;font-size:12px;margin-top:32px">
            You're receiving this because you created an answerLoops workspace.
          </p>
        </div>
      `,
    })
  } catch (err) {
    // Swallowed on purpose — see the note above. Logged so a provider outage is
    // visible rather than silent.
    console.error('[email] welcome email failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function sendSlaBreachEmails(
  breachedTickets: { id: number; org_ticket_number: number }[],
  orgId: number
): Promise<void> {
  if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) return
  if (breachedTickets.length === 0) return

  const to = await getAdminEmails(orgId)
  if (to.length === 0) return

  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const ticketLinks = breachedTickets
    .map(
      (t) =>
        `<li><a href="${base}/tickets/${t.org_ticket_number}" style="color:#4f46e5">Ticket #${t.org_ticket_number}</a></li>`
    )
    .join('')

  await client().emails.send({
    from: from(),
    to,
    subject: `SLA breach: ${breachedTickets.length} ticket${breachedTickets.length > 1 ? 's' : ''} overdue`,
    html: `
      <div style="${BASE_STYLE}">
        <h2 style="font-size:18px;font-weight:600;color:#991b1b;margin-bottom:8px">
          SLA breach alert
        </h2>
        <p style="${MUTED};margin-bottom:16px">
          ${breachedTickets.length} ticket${breachedTickets.length > 1 ? 's have' : ' has'} missed their SLA deadline:
        </p>
        <ul style="padding-left:20px;${MUTED}">${ticketLinks}</ul>
        <p style="margin-top:24px">
          <a href="${base}/tickets"
             style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none">
            View all tickets
          </a>
        </p>
      </div>
    `,
  })
}

/**
 * OAuth mailbox revocation (Gmail or Outlook) is unavoidably reactive —
 * neither Google nor Microsoft pushes a "revoked" signal, it only surfaces
 * as a generic error on the next send attempt. Sent same-day so replies
 * don't silently keep falling back to the platform address without anyone
 * noticing the connection died.
 */
export async function notifyAdminsOauthDisconnected(orgId: number, provider: 'gmail' | 'outlook'): Promise<void> {
  if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) return

  const to = await getAdminEmails(orgId)
  if (to.length === 0) return

  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const settingsUrl = `${base}/settings?tab=email`
  const providerLabel = provider === 'gmail' ? 'Gmail' : 'Outlook'

  await client().emails.send({
    from: from(),
    to,
    subject: `${providerLabel} connection lost — replies falling back to the default address`,
    html: `
      <div style="${BASE_STYLE}">
        <h2 style="font-size:18px;font-weight:600;color:#991b1b;margin-bottom:8px">
          ${providerLabel} connection lost
        </h2>
        <p style="${MUTED};margin-bottom:16px">
          Your connected ${providerLabel} mailbox stopped accepting AI replies — this usually happens after a password
          change, admin revocation, or long inactivity. Replies are falling back to the platform-hosted
          address until you reconnect.
        </p>
        <a href="${settingsUrl}"
           style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none">
          Reconnect ${providerLabel}
        </a>
      </div>
    `,
  })
}
