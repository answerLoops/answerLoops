import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/billing/stripe'
import {
  upsertSubscription,
  upsertSubscriptionAndClaimWelcome,
  getSubscription,
  getSubscriptionByStripeId,
  hasProcessedWebhookEvent,
  markWebhookEventProcessed,
  pruneOldWebhookEvents,
} from '@/lib/db/queries/billing'
import { priceIdToPlan, getPlan } from '@/lib/billing/plans'
import { getOrgOwner } from '@/lib/db/queries/members'
import { sendWelcomeEmail } from '@/lib/email/send'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

// Fire-and-forget dedup-table cleanup, time-gated rather than probabilistic —
// same contract as rateLimitShared's sweep in lib/ratelimit.ts. Webhook
// volume is low, so a 24h interval is plenty; Stripe doesn't retry a
// delivery past a few days, so nothing needs to be kept longer than that.
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000
let nextPruneAt = 0

function maybePruneWebhookEvents(): void {
  const now = Date.now()
  if (now < nextPruneAt) return
  nextPruneAt = now + PRUNE_INTERVAL_MS
  pruneOldWebhookEvents().catch(() => {})
}

// Stripe doesn't guarantee in-order delivery. Without this, a delayed event
// carrying older state (e.g. a still-'active' update queued before a
// cancellation, delivered after it) can silently overwrite newer state —
// the same subscription row resurrecting access right after a legitimate
// cancellation. event.created is Stripe's own event timestamp (unix
// seconds), compared against the last one actually applied to the row.
function isStaleEvent(lastAppliedEventCreated: number | null | undefined, event: Stripe.Event): boolean {
  return lastAppliedEventCreated != null && event.created <= lastAppliedEventCreated
}

// Stripe requires raw body for signature verification — disable body parsing.
export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    logger.error('STRIPE_WEBHOOK_SECRET not set', { module: 'billing/webhook' })
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    const body = await req.text()
    event = getStripe().webhooks.constructEvent(body, sig ?? '', webhookSecret)
  } catch (err) {
    logger.warn('Stripe webhook signature verification failed', { module: 'billing/webhook', error: err })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const MOD = 'billing/webhook'

  maybePruneWebhookEvents()

  // Stripe retries on any non-2xx response, or on a timeout even after we've
  // already applied the event — so the same event.id can arrive more than
  // once. Our upserts are individually idempotent, but skipping a known
  // duplicate outright avoids redundant work and noisy logs on legitimate
  // retries, and is a hard requirement for the ordering guard below to mean
  // anything (re-applying the same event would just re-set the same
  // last_event_created, masking whether ordering was actually checked).
  if (await hasProcessedWebhookEvent(event.id)) {
    logger.info('Webhook event already processed — skipping', { module: MOD, eventId: event.id, type: event.type })
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break

        const orgId = Number(session.metadata?.org_id)
        if (!orgId) break

        // Normalized through getPlan() rather than trusted verbatim — a
        // checkout session created on old code (a stale/renamed plan id in
        // its metadata) completing after a plan-id rename ships must not
        // persist a string that's no longer a valid PlanId. There is no
        // free tier to fall back to, so this is refused rather than
        // defaulted: a brand-new org has no existing row to preserve, and
        // defaulting to any real plan here would grant paid access the org
        // never purchased. Returning 500 (instead of marking the event
        // processed) makes Stripe retry, buying time to fix the plan
        // mapping without ever having handed out unearned access.
        const requestedPlan = getPlan(session.metadata?.plan_id)
        if (!requestedPlan) {
          logger.error('Checkout completed with unrecognized plan_id — refusing to grant access', {
            module: MOD,
            orgId,
            planId: session.metadata?.plan_id,
          })
          return NextResponse.json({ error: 'Unrecognized plan_id' }, { status: 500 })
        }

        // The read and write must be one transaction. Stripe can deliver two
        // checkout events for an org concurrently; a standalone read-before-
        // write lets both requests decide they are the first subscription.
        const isFirstSubscription = await upsertSubscriptionAndClaimWelcome({
          orgId,
          planId: requestedPlan.id,
          status: 'trialing',
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          lastEventCreated: event.created,
        })
        logger.info('Trial started via checkout', { module: MOD, orgId })

        // The welcome email is sent from here rather than from account
        // creation. Finishing OAuth makes someone a user; finishing checkout
        // makes them a customer with a dashboard to be welcomed into, and only
        // the second is worth an email. Sent at most once per org: this event
        // is deduplicated by id above, and the first-subscription check means
        // a cancel-and-resubscribe does not trigger a second one.
        //
        // Addressed to the org owner from our own records rather than to
        // whatever address Stripe collected — someone may pay with a different
        // address than they signed up with, and the account is what they will
        // sign back into.
        //
        // Nothing here may throw. A mail failure must not turn into a non-2xx,
        // because Stripe would retry an event whose subscription is already
        // written. If it somehow does, the retry is harmless: the atomic
        // claim returns false after the row exists, so no second email is sent.
        if (isFirstSubscription) {
          try {
            const owner = await getOrgOwner(orgId)
            const to = owner?.email ?? session.customer_details?.email ?? null
            if (to) {
              await sendWelcomeEmail(to, owner?.name ?? session.customer_details?.name ?? null)
            } else {
              logger.warn('First subscription with no address to welcome', { module: MOD, orgId })
            }
          } catch (err) {
            logger.error('Welcome email failed after checkout', { module: MOD, orgId, error: err })
          }
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const orgId = Number(sub.metadata?.org_id)
        if (!orgId) break

        const existingSub = await getSubscriptionByStripeId(sub.id)
        if (isStaleEvent(existingSub?.lastEventCreated, event)) {
          logger.warn('Stale/out-of-order subscription.updated event — skipping', {
            module: MOD,
            orgId,
            eventCreated: event.created,
            lastApplied: existingSub?.lastEventCreated,
          })
          break
        }

        const priceId = sub.items.data[0]?.price?.id ?? null
        const plan = priceId ? priceIdToPlan(priceId) : null
        // Preserve the existing plan association when the price can't be
        // resolved (misconfigured price env var, or a price we don't yet
        // map) rather than reassigning to a fallback — a real Pro/Enterprise
        // customer must not silently downgrade to Standard because of a
        // mapping bug. When there's no existing row AND no resolvable price,
        // there is nothing legitimate to base a plan on — skip the write
        // entirely rather than fabricating a 'standard' row, which would
        // grant paid access an org never purchased. The subsequent
        // checkout.session.completed (or its retry) is what actually
        // establishes this org's subscription.
        if (!plan && !existingSub) {
          logger.error('subscription.updated with unresolvable price and no existing row — skipping', {
            module: MOD,
            orgId,
            priceId,
          })
          break
        }
        const planId = plan?.id ?? existingSub!.planId

        // current_period_start/current_period_end live on the subscription
        // ITEM, not on the Subscription object itself — confirmed against
        // real production event payloads (neither field appears at the top
        // level) and against the Stripe Node SDK's own types (SubscriptionItem
        // declares them; Subscription does not). Reading them off `sub`
        // directly, as this used to, meant `subAny.current_period_start` was
        // always undefined, `new Date(undefined * 1000)` is an Invalid Date,
        // and `.toISOString()` on an Invalid Date throws — turning every
        // customer.subscription.updated delivery into a 500, silently, for
        // every org. Confirmed live: a real event's webhook delivery log
        // showed exactly this 500 on every retry. We only ever have one
        // subscription item per org (see priceId above, same assumption).
        const item = sub.items.data[0] as unknown as {
          current_period_start: number
          current_period_end: number
        } | undefined
        const subAny = sub as unknown as { trial_end: number | null }
        const trialEndsAt = subAny.trial_end
          ? new Date(subAny.trial_end * 1000).toISOString()
          : null

        if (!item) {
          logger.error('subscription.updated with no subscription item — skipping', {
            module: MOD,
            orgId,
            subscriptionId: sub.id,
          })
          break
        }

        await upsertSubscription({
          orgId,
          planId,
          status: sub.status,
          stripeCustomerId: sub.customer as string,
          stripeSubscriptionId: sub.id,
          stripePriceId: priceId,
          currentPeriodStart: new Date(item.current_period_start * 1000).toISOString(),
          currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          trialEndsAt,
          lastEventCreated: event.created,
        })
        logger.info('Subscription updated', { module: MOD, orgId, status: sub.status })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const orgId = Number(sub.metadata?.org_id)
        if (!orgId) break

        const existingSub = await getSubscriptionByStripeId(sub.id)
        if (isStaleEvent(existingSub?.lastEventCreated, event)) {
          logger.warn('Stale/out-of-order subscription.deleted event — skipping', {
            module: MOD,
            orgId,
            eventCreated: event.created,
            lastApplied: existingSub?.lastEventCreated,
          })
          break
        }

        // There is no free tier to fall back to — status: 'canceled' is what
        // revokes access (see hasActiveAccess in lib/billing/plans.ts).
        // planId is preserved from the existing row (what they churned from)
        // purely for historical/analytics purposes; it grants nothing once
        // status is 'canceled'.
        await upsertSubscription({
          orgId,
          planId: existingSub?.planId ?? 'standard',
          status: 'canceled',
          stripeSubscriptionId: sub.id,
          cancelAtPeriodEnd: false,
          lastEventCreated: event.created,
        })
        logger.info('Subscription canceled — access revoked', { module: MOD, orgId })
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const invoiceAny = invoice as unknown as {
          subscription?: string | null
          subscription_details?: { metadata?: { org_id?: string } }
        }
        const subId = invoiceAny.subscription ?? null
        if (!subId) break

        const orgId = Number(invoiceAny.subscription_details?.metadata?.org_id)
        if (!orgId) break

        const existingSub = await getSubscriptionByStripeId(subId)
        if (isStaleEvent(existingSub?.lastEventCreated, event)) {
          logger.warn('Stale/out-of-order invoice.payment_failed event — skipping', {
            module: MOD,
            orgId,
            eventCreated: event.created,
            lastApplied: existingSub?.lastEventCreated,
          })
          break
        }

        // 'past_due' still counts as active access (hasActiveAccess in
        // lib/billing/plans.ts) — defaulting planId to 'standard' here for
        // an org with no existing row would grant real paid access to an
        // org whose subscription we've never actually seen. Skip rather
        // than fabricate one; there's nothing legitimate to mark past_due.
        if (!existingSub) {
          logger.error('invoice.payment_failed with no existing subscription row — skipping', {
            module: MOD,
            orgId,
            stripeSubscriptionId: subId,
          })
          break
        }

        await upsertSubscription({
          orgId,
          planId: existingSub.planId,
          status: 'past_due',
          stripeSubscriptionId: subId,
          lastEventCreated: event.created,
        })
        logger.warn('Payment failed — subscription past_due', { module: MOD, orgId })
        break
      }

      default:
        break
    }
  } catch (err) {
    logger.error('Webhook handler error', { module: MOD, event: event.type, error: err })
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }

  await markWebhookEventProcessed(event.id)
  return NextResponse.json({ received: true })
}
