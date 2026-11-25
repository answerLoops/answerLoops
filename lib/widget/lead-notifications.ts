import {
  claimWidgetLeadEmailWindow,
  listOrgsWithPendingWidgetLeads,
  listPendingWidgetLeads,
  markWidgetLeadsNotified,
} from '@/lib/db/queries/widget-leads'
import { getOrgMembers } from '@/lib/db/queries/members'
import { emailServiceConfigured, leadsPageUrl, sendWidgetLeadEmail } from '@/lib/email/widget-lead'
import { logger } from '@/lib/logger'

const MOD = 'widget/lead-notifications'

/**
 * A workspace is emailed at most once in this many minutes, however many
 * visitors leave their address. The first lead after a quiet spell goes out at
 * once; leads that arrive while the window is closed wait and go out together.
 */
export const LEAD_EMAIL_WINDOW_MINUTES = 10

/** Leads listed in one email; the rest are counted ("+N more") with a link. */
export const LEAD_EMAIL_MAX_LISTED = 10

/** Workspaces the periodic sweep handles in one run. */
export const LEAD_SWEEP_MAX_ORGS = 100

export type LeadEmailOutcome = 'sent' | 'nothing-pending' | 'waiting' | 'no-email-service' | 'no-recipients' | 'failed'

/**
 * Emails a workspace's owners and admins about the leads that are waiting, if
 * the workspace's window is open. Owners and admins are the same people the
 * app's other team emails go to.
 *
 * What happens when it cannot send: with no email service configured it does
 * nothing and leaves the leads waiting (a self-hosted install without email
 * just uses the Leads page). When the mail provider refuses a send, the window
 * stays used and the leads stay waiting, so the next email (the next lead, or
 * the periodic sweep) includes them.
 */
export async function sendPendingLeadEmail(orgId: number): Promise<LeadEmailOutcome> {
  if (!emailServiceConfigured()) {
    logger.debug('lead email skipped: no email service configured', { module: MOD, orgId })
    return 'no-email-service'
  }

  const first = await listPendingWidgetLeads(orgId, 1)
  if (first.total === 0) return 'nothing-pending'

  if (!(await claimWidgetLeadEmailWindow(orgId, LEAD_EMAIL_WINDOW_MINUTES))) return 'waiting'

  const members = await getOrgMembers(orgId)
  const to = [...new Set(members.filter((m) => m.email && ['owner', 'admin'].includes(m.role)).map((m) => m.email as string))]
  if (to.length === 0) {
    logger.warn('lead email has no owner or admin address to go to', { module: MOD, orgId })
    return 'no-recipients'
  }

  const pending = await listPendingWidgetLeads(orgId, LEAD_EMAIL_MAX_LISTED)
  if (pending.total === 0) return 'nothing-pending'

  const sent = await sendWidgetLeadEmail(to, {
    leads: pending.leads.map((l) => ({ email: l.email, question: l.question })),
    moreCount: Math.max(0, pending.total - pending.leads.length),
    leadsUrl: leadsPageUrl(),
  })
  if (!sent) return 'failed'

  // Only the leads that were in this email's snapshot; one that arrived while it
  // was being sent waits for the next email.
  await markWidgetLeadsNotified(orgId, pending.maxId)
  return 'sent'
}

/**
 * Called after a new lead is saved. Never throws and is never awaited by the
 * visitor's request: a problem emailing the team must not affect the visitor.
 */
export async function notifyNewWidgetLead(orgId: number): Promise<void> {
  try {
    await sendPendingLeadEmail(orgId)
  } catch (error) {
    logger.error('lead notification failed', { module: MOD, orgId, error })
  }
}

/**
 * The periodic sweep: sends the grouped email for every workspace that has
 * leads waiting and whose window has closed. Without it, leads that arrive
 * during a window would wait until the next lead for that workspace.
 */
export async function runWidgetLeadDigests(): Promise<{ considered: number; sent: number; failed: number }> {
  if (!emailServiceConfigured()) return { considered: 0, sent: 0, failed: 0 }
  const orgIds = await listOrgsWithPendingWidgetLeads(LEAD_EMAIL_WINDOW_MINUTES, LEAD_SWEEP_MAX_ORGS)
  let sent = 0
  let failed = 0
  for (const orgId of orgIds) {
    try {
      const outcome = await sendPendingLeadEmail(orgId)
      if (outcome === 'sent') sent += 1
      else if (outcome === 'failed') failed += 1
    } catch (error) {
      failed += 1
      logger.error('lead digest failed for a workspace', { module: MOD, orgId, error })
    }
  }
  return { considered: orgIds.length, sent, failed }
}
