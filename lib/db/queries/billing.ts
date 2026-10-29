import { eq, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { subscriptions, webhookEvents } from '../schema'
import { isAppManagedTrial, trialHasEnded } from '@/lib/billing/trial'

interface Subscription {
  id: number
  orgId: number
  planId: string
  status: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  trialEndsAt: string | null
  lastEventCreated: number | null
  createdAt: string
  updatedAt: string
}

/**
 * The status every access check reads. A trial this app started has no Stripe
 * subscription to end it, so nothing would ever flip the stored row: the
 * expiry is applied here, at the one place all subscription reads pass
 * through, so no caller can forget it. `trial_expired` is outside the set of
 * statuses that grant access (hasActiveAccess) and outside the AI budget tiers
 * (tierForStatus), so the org is locked out until it subscribes and a card is
 * taken at checkout.
 */
function effectiveStatus(row: typeof subscriptions.$inferSelect): string {
  const trial = { status: row.status, stripeSubscriptionId: row.stripeSubscriptionId }
  return isAppManagedTrial(trial) && trialHasEnded(row.trialEndsAt) ? 'trial_expired' : row.status
}

function toSub(row: typeof subscriptions.$inferSelect): Subscription {
  return {
    id: row.id,
    orgId: row.orgId,
    planId: row.planId,
    status: effectiveStatus(row),
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    stripePriceId: row.stripePriceId,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === 1,
    trialEndsAt: row.trialEndsAt ?? null,
    lastEventCreated: row.lastEventCreated ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function getSubscription(orgId: number): Promise<Subscription | null> {
  const [row] = await getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1)
  return row ? toSub(row) : null
}

export async function getSubscriptionByStripeId(stripeSubId: string): Promise<Subscription | null> {
  const [row] = await getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
    .limit(1)
  return row ? toSub(row) : null
}

export async function upsertSubscription(input: {
  orgId: number
  planId: string
  status: string
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  stripePriceId?: string | null
  currentPeriodStart?: string | null
  currentPeriodEnd?: string | null
  cancelAtPeriodEnd?: boolean
  trialEndsAt?: string | null
  lastEventCreated?: number | null
}): Promise<void> {
  const now = new Date().toISOString()
  await getDb()
    .insert(subscriptions)
    .values({
      orgId: input.orgId,
      planId: input.planId,
      status: input.status,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      stripePriceId: input.stripePriceId ?? null,
      currentPeriodStart: input.currentPeriodStart ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0,
      trialEndsAt: input.trialEndsAt ?? null,
      lastEventCreated: input.lastEventCreated ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.orgId,
      set: {
        planId: input.planId,
        status: input.status,
        ...(input.stripeCustomerId !== undefined ? { stripeCustomerId: input.stripeCustomerId } : {}),
        ...(input.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: input.stripeSubscriptionId } : {}),
        ...(input.stripePriceId !== undefined ? { stripePriceId: input.stripePriceId } : {}),
        ...(input.currentPeriodStart !== undefined ? { currentPeriodStart: input.currentPeriodStart } : {}),
        ...(input.currentPeriodEnd !== undefined ? { currentPeriodEnd: input.currentPeriodEnd } : {}),
        ...(input.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0 } : {}),
        ...(input.trialEndsAt !== undefined ? { trialEndsAt: input.trialEndsAt } : {}),
        ...(input.lastEventCreated !== undefined ? { lastEventCreated: input.lastEventCreated } : {}),
        updatedAt: now,
      },
    })
}

/**
 * Upserts the subscription while atomically claiming the org's first welcome.
 *
 * Stripe can deliver two checkout events for one org concurrently. The caller
 * must not perform a read-before-write outside a transaction: both requests
 * can observe an empty subscriptions row and both send the welcome email. The
 * advisory transaction lock serializes checkout completion for this org, so
 * exactly one caller sees the org without a subscription.
 */
export async function upsertSubscriptionAndClaimWelcome(input: {
  orgId: number
  planId: string
  status: string
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  stripePriceId?: string | null
  currentPeriodStart?: string | null
  currentPeriodEnd?: string | null
  cancelAtPeriodEnd?: boolean
  trialEndsAt?: string | null
  lastEventCreated?: number | null
}): Promise<boolean> {
  const now = new Date().toISOString()
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8451, ${input.orgId})`)

    const [existing] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, input.orgId))
      .limit(1)

    await tx
      .insert(subscriptions)
      .values({
        orgId: input.orgId,
        planId: input.planId,
        status: input.status,
        stripeCustomerId: input.stripeCustomerId ?? null,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        stripePriceId: input.stripePriceId ?? null,
        currentPeriodStart: input.currentPeriodStart ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0,
        trialEndsAt: input.trialEndsAt ?? null,
        lastEventCreated: input.lastEventCreated ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: subscriptions.orgId,
        set: {
          planId: input.planId,
          status: input.status,
          ...(input.stripeCustomerId !== undefined ? { stripeCustomerId: input.stripeCustomerId } : {}),
          ...(input.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: input.stripeSubscriptionId } : {}),
          ...(input.stripePriceId !== undefined ? { stripePriceId: input.stripePriceId } : {}),
          ...(input.currentPeriodStart !== undefined ? { currentPeriodStart: input.currentPeriodStart } : {}),
          ...(input.currentPeriodEnd !== undefined ? { currentPeriodEnd: input.currentPeriodEnd } : {}),
          ...(input.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0 } : {}),
          ...(input.trialEndsAt !== undefined ? { trialEndsAt: input.trialEndsAt } : {}),
          ...(input.lastEventCreated !== undefined ? { lastEventCreated: input.lastEventCreated } : {}),
          updatedAt: now,
        },
      })

    return !existing
  })
}

/**
 * Atomically claims a Stripe event id before it is handled: a single
 * INSERT .. ON CONFLICT DO NOTHING RETURNING. Exactly one concurrent delivery
 * gets `true`; every other delivery of the same event gets `false` and must not
 * handle it.
 */
export async function claimWebhookEvent(eventId: string): Promise<boolean> {
  const rows = await getDb()
    .insert(webhookEvents)
    .values({ eventId })
    .onConflictDoNothing()
    .returning({ eventId: webhookEvents.eventId })
  return rows.length > 0
}

/** Gives a claim back after the handler failed, so Stripe's retry is processed rather than skipped. */
export async function releaseWebhookEventClaim(eventId: string): Promise<void> {
  await getDb().delete(webhookEvents).where(eq(webhookEvents.eventId, eventId))
}

/** Cleans up dedup rows older than the retention window — Stripe doesn't retry past a few days, so nothing needs to be kept longer. */
export async function pruneOldWebhookEvents(olderThanDays = 7): Promise<void> {
  await getDb()
    .delete(webhookEvents)
    .where(sql`${webhookEvents.processedAt} < now() - (${olderThanDays} || ' days')::interval`)
}
