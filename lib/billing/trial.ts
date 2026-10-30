import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { subscriptions, trialClaims } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getDeploymentMode, TRIAL_DAYS, type PlanId } from './plans'

const MOD = 'billing/trial'

/**
 * The plan a trial runs on: the top one, so a trialer sees every feature.
 * Platform AI usage is still capped by the trial budget tier (see
 * lib/billing/platform-ai-budget.ts) — the trial opens features, not spend.
 */
export const TRIAL_PLAN_ID: PlanId = 'enterprise'

/**
 * Reduces an email to the identity a trial is limited to.
 *
 * The same person can write one mailbox many ways, and each way is a new row
 * in `users`. Folded here: case, a `+tag` on any domain, the googlemail.com
 * alias, and dots on gmail.com (where they are ignored by the provider).
 * Dots are kept on every other domain because there they can be significant.
 *
 * Returns null for anything that is not a plausible address, so a malformed
 * value can never become a shared key. Mirrored in SQL by the backfill in
 * drizzle/0067_free_trial_and_signup_consent.sql.
 */
export function normalizeIdentity(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at < 1 || at === trimmed.length - 1) return null
  let local = trimmed.slice(0, at).split('+')[0]
  let domain = trimmed.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.replaceAll('.', '')
  if (!local || !domain.includes('.')) return null
  return `${local}@${domain}`
}

/**
 * The ledger stores a SHA-256 of the normalized identity, not the address.
 * The ledger deliberately outlives workspaces and accounts, so it must not be
 * a retained copy of anyone's email; a hash still answers "have we seen this
 * person" and nothing else. Mirrored in SQL by the 0067 backfill.
 */
export function identityHash(identity: string): string {
  return createHash('sha256').update(identity, 'utf8').digest('hex')
}

export type TrialOutcome =
  | { status: 'started'; endsAt: Date }
  | { status: 'already-used' }
  | { status: 'not-applicable' }

interface StartTrialInput {
  orgId: number
  userId: number
  email: string
  /** The sign-in provider's stable account id; null when it did not supply one. */
  providerSubject: string | null
}

/**
 * Starts the card-free trial for an org, once per person, ever.
 *
 * The claim and the subscription row are written in one transaction, and the
 * ledger's two UNIQUE keys (normalized email, provider account id) are what
 * decide the race: `ON CONFLICT DO NOTHING` returns no row when either key was
 * already claimed, so two concurrent sign-ins, a deleted-and-recreated
 * account, a second org, or a plus-addressed or dotted variant of the same
 * mailbox all land on `already-used`. No application-level read-then-write is
 * involved, so there is no window to slip through.
 *
 * An org that already has a subscription row is left untouched and consumes no
 * claim, so a paying or lapsed customer is never reset to a trial.
 *
 * Not applicable on self-hosted, where there is no billing to gate.
 */
export async function startTrial(input: StartTrialInput): Promise<TrialOutcome> {
  if (getDeploymentMode() !== 'cloud') return { status: 'not-applicable' }

  const identity = normalizeIdentity(input.email)
  if (!identity) {
    logger.warn('Cannot start a trial: email has no usable identity', { module: MOD, orgId: input.orgId })
    return { status: 'already-used' }
  }

  const identityKey = identityHash(identity)
  const endsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)

  return getDb().transaction(async (tx) => {
    // Serialize per org so the existence check and both inserts see one state.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8452, ${input.orgId})`)

    const [existing] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, input.orgId))
      .limit(1)
    if (existing) return { status: 'already-used' } as const

    const claimed = await tx
      .insert(trialClaims)
      .values({
        identityKey,
        providerSubject: input.providerSubject,
        userId: input.userId,
        orgId: input.orgId,
        endsAt,
      })
      .onConflictDoNothing()
      .returning({ id: trialClaims.id })
    if (claimed.length === 0) return { status: 'already-used' } as const

    await tx.insert(subscriptions).values({
      orgId: input.orgId,
      planId: TRIAL_PLAN_ID,
      status: 'trialing',
      trialEndsAt: endsAt.toISOString(),
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: endsAt.toISOString(),
    })

    logger.info('Trial started', { module: MOD, orgId: input.orgId })
    return { status: 'started', endsAt } as const
  })
}

/**
 * A trial that this app started (no Stripe subscription behind it), as
 * opposed to a paid subscription. Only these can run out on their own.
 */
export function isAppManagedTrial(sub: { status: string; stripeSubscriptionId: string | null }): boolean {
  return sub.status === 'trialing' && !sub.stripeSubscriptionId
}

/** Whether an app-managed trial's window has closed. */
export function trialHasEnded(trialEndsAt: string | null, now: Date = new Date()): boolean {
  if (!trialEndsAt) return true
  const end = Date.parse(trialEndsAt)
  return Number.isNaN(end) || end <= now.getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whole days left in an app-managed trial, rounded up so the last partial day
 * still reads as one day. Zero once it has ended. Null when the subscription is
 * not an app-managed trial (a paid plan, or a legacy card-backed one).
 */
export function trialDaysLeft(
  sub: { status: string; stripeSubscriptionId: string | null; trialEndsAt: string | null },
  now: Date = new Date(),
): number | null {
  if (!isAppManagedTrial(sub)) return null
  if (trialHasEnded(sub.trialEndsAt, now)) return 0
  return Math.ceil((Date.parse(sub.trialEndsAt as string) - now.getTime()) / DAY_MS)
}

/** The warning window: the dashboard banner shows, and reminders start, this many days out. */
export const TRIAL_WARNING_DAYS = 3
