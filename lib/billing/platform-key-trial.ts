import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'

/**
 * Lifetime free-trial ticket count an org with no configured AI provider
 * gets on answerLoops' own platform key, before onboarding requires their
 * own key. One-time per org, not monthly — deliberately smaller than a
 * billing concern (see lib/billing/usage.ts's deflectionsPerMonth), just
 * enough for a new signup to see auto-triage/drafting/deflection actually
 * work end-to-end.
 */
export const PLATFORM_KEY_TRIAL_LIMIT = 5

export interface PlatformKeyTrialStatus {
  used: number
  limit: number
  remaining: number
  exhausted: boolean
}

export async function getPlatformKeyTrialStatus(orgId: number): Promise<PlatformKeyTrialStatus> {
  const rows = (await getDb().execute(sql`
    SELECT platform_key_trial_used AS used FROM orgs WHERE id = ${orgId}
  `)) as unknown as { used: number }[]
  const used = Math.min(rows[0]?.used ?? PLATFORM_KEY_TRIAL_LIMIT, PLATFORM_KEY_TRIAL_LIMIT)
  return {
    used,
    limit: PLATFORM_KEY_TRIAL_LIMIT,
    remaining: PLATFORM_KEY_TRIAL_LIMIT - used,
    exhausted: used >= PLATFORM_KEY_TRIAL_LIMIT,
  }
}

/**
 * Atomically claims one trial credit for a ticket about to be processed on
 * the platform key. The WHERE clause's `< PLATFORM_KEY_TRIAL_LIMIT` and the
 * increment happen in the same statement, so Postgres's row-level lock on
 * the `orgs` row serializes concurrent callers the same way
 * getNextOrgTicketNumber does — no separate advisory lock needed. Returns
 * false once the org has used all 5, or immediately once the org has any
 * configured AI key (callers should check that first and never call this
 * at all in that case).
 */
export async function reservePlatformKeyTrial(orgId: number): Promise<boolean> {
  const rows = (await getDb().execute(sql`
    UPDATE orgs
    SET platform_key_trial_used = platform_key_trial_used + 1
    WHERE id = ${orgId} AND platform_key_trial_used < ${PLATFORM_KEY_TRIAL_LIMIT}
    RETURNING id
  `)) as unknown as { id: number }[]
  return rows.length > 0
}
