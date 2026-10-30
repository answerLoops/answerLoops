import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { getOrgOwner } from '@/lib/db/queries/members'
import { sendTrialEndingEmail, type TrialEndingKind } from '@/lib/email/send'
import { appOrigin } from '@/lib/site'
import { logger } from '@/lib/logger'
import { TRIAL_WARNING_DAYS } from './trial'

const MOD = 'billing/trial-reminders'
const DAY_MS = 24 * 60 * 60 * 1000

// Static fragments chosen by kind, never built from a string: nothing here
// feeds sql.raw (see tests/unit/platform-ai-budget-infra.test.ts).
const column = (kind: TrialEndingKind) =>
  kind === '3d' ? sql`trial_reminder_3d_sent_at` : sql`trial_reminder_1d_sent_at`

interface Candidate {
  id: number
  org_id: number
  trial_ends_at: string
  sent_3d: boolean
  sent_1d: boolean
}

/**
 * Which notice a trial is due, if any. Decided by how long is left rather than
 * by a schedule, so a sweep that was down for a day sends the notice that is
 * true now — a trial with 20 hours left gets the one-day notice, never a stale
 * "3 days" one. Each notice goes at most once.
 */
export function dueReminder(
  endsAtMs: number,
  sent: { threeDay: boolean; oneDay: boolean },
  now: number,
): TrialEndingKind | null {
  const left = endsAtMs - now
  if (left <= 0 || left > TRIAL_WARNING_DAYS * DAY_MS) return null
  if (left <= DAY_MS) return sent.oneDay ? null : '1d'
  return sent.threeDay ? null : '3d'
}

/** Where the button in the email lands: straight on checkout, signing in first if the session has lapsed. */
export function checkoutUrlFor(kind: TrialEndingKind): string {
  const base = appOrigin() ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const params = new URLSearchParams({
    utm_source: 'email',
    utm_medium: 'lifecycle',
    utm_campaign: `trial_ending_${kind}`,
  })
  return `${base}/checkout?${params}`
}

// Claimed before sending, by one conditional UPDATE, so two sweeps that overlap
// (or a retry of a request that timed out) cannot both send the same notice.
// The row must still be an app-run trial: someone who subscribed since the
// candidate list was read has no trial left to be warned about.
async function claim(subscriptionId: number, kind: TrialEndingKind): Promise<boolean> {
  const col = column(kind)
  const rows = (await getDb().execute(sql`
    UPDATE subscriptions SET ${col} = now()
    WHERE id = ${subscriptionId} AND ${col} IS NULL
      AND status = 'trialing' AND stripe_subscription_id IS NULL
    RETURNING id
  `)) as unknown as unknown[]
  return rows.length > 0
}

// A notice that could not be sent goes back to unsent, so the next sweep tries again.
async function release(subscriptionId: number, kind: TrialEndingKind): Promise<void> {
  const col = column(kind)
  await getDb().execute(sql`UPDATE subscriptions SET ${col} = NULL WHERE id = ${subscriptionId}`)
}

async function listCandidates(now: Date): Promise<Candidate[]> {
  const horizon = new Date(now.getTime() + TRIAL_WARNING_DAYS * DAY_MS).toISOString()
  return (await getDb().execute(sql`
    SELECT s.id, s.org_id, s.trial_ends_at,
           s.trial_reminder_3d_sent_at IS NOT NULL AS sent_3d,
           s.trial_reminder_1d_sent_at IS NOT NULL AS sent_1d
    FROM subscriptions s
    JOIN orgs o ON o.id = s.org_id AND o.deleted_at IS NULL
    WHERE s.status = 'trialing' AND s.stripe_subscription_id IS NULL
      AND s.trial_ends_at IS NOT NULL
      AND s.trial_ends_at::timestamptz > ${now.toISOString()}::timestamptz
      AND s.trial_ends_at::timestamptz <= ${horizon}::timestamptz
  `)) as unknown as Candidate[]
}

export interface ReminderRunResult {
  considered: number
  sent: number
  failed: number
}

/**
 * Sends every trial-ending notice that is due. Run on an interval by the bot
 * service through POST /api/billing/trial-reminders/run; safe to run as often
 * as you like and from more than one place at once.
 */
export async function runTrialReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { considered: 0, sent: 0, failed: 0 }
  const candidates = await listCandidates(now)

  for (const c of candidates) {
    const endsAt = new Date(c.trial_ends_at)
    const kind = dueReminder(endsAt.getTime(), { threeDay: c.sent_3d, oneDay: c.sent_1d }, now.getTime())
    if (!kind) continue
    result.considered++

    try {
      if (!(await claim(c.id, kind))) continue

      const owner = await getOrgOwner(c.org_id)
      if (!owner?.email) {
        // Nobody to write to. Leave it claimed: retrying cannot help.
        logger.warn('Trial reminder skipped: workspace has no owner email', { module: MOD, orgId: c.org_id, kind })
        continue
      }

      const delivered = await sendTrialEndingEmail(owner.email, owner.name, {
        kind,
        endsAt,
        checkoutUrl: checkoutUrlFor(kind),
      })
      if (delivered) {
        result.sent++
        logger.info('Trial reminder sent', { module: MOD, orgId: c.org_id, kind })
      } else {
        await release(c.id, kind)
        result.failed++
      }
    } catch (err) {
      result.failed++
      logger.error('Trial reminder failed', { module: MOD, orgId: c.org_id, kind, error: err })
      await release(c.id, kind).catch(() => {})
    }
  }
  return result
}
