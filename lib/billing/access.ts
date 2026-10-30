import { getSubscription } from '@/lib/db/queries/billing'
import { getDeploymentMode, hasActiveAccess } from './plans'
import { isAppManagedTrial } from './trial'

/**
 * Whether an org may use the product at all.
 *
 * Signing in is not itself access. A new account is given a card-free trial
 * (lib/billing/trial.ts) as a subscription row, and access is scoped to
 * subscriptions rather than to sessions. When the trial runs out, or an
 * account has already used its one trial, there is no live subscription and
 * the person is sent to /checkout, where subscribing takes a card. A dashboard
 * that loads while refusing every AI answer is a worse experience than being
 * asked to pick a plan.
 *
 * Read from our own `subscriptions` table rather than Stripe, so this stays a
 * cheap local check on every request and keeps working through a Stripe outage
 * or a rotated key. The webhook is what keeps the table current.
 *
 * `trialing` counts as active — that is the whole point of the trial. An
 * app-managed trial past its end date reads as `trial_expired` (see
 * getSubscription), which does not.
 */
export async function orgHasProductAccess(orgId: number): Promise<boolean> {
  // Self-hosted runs on the operator's own infrastructure and keys. There is
  // no subscription to have, so gating on one would lock every self-hoster out
  // of their own install.
  if (getDeploymentMode() === 'self-hosted') return true

  const sub = await getSubscription(orgId)
  return hasActiveAccess(sub?.status)
}

/**
 * Paths an authenticated-but-unsubscribed user must still reach, or the gate
 * traps them with no way forward.
 *
 * Kept as an explicit list rather than a pattern: each entry is here for a
 * specific reason, and a new one should have to justify itself.
 */
export const ACCESS_EXEMPT_PATHS: readonly string[] = [
  // The whole point of the gate is to send people here.
  '/start-trial',
  // Creating and returning from a checkout session.
  '/api/billing/checkout',
  // The billing page reads this to decide what to show; blocking it would
  // leave a subscribed-but-lapsed user staring at a page that cannot explain
  // itself.
  '/api/billing/status',
  // Managing or cancelling an existing subscription. A cancelled org fails the
  // access check, so gating the portal would remove the only way to resubscribe.
  '/api/billing/portal',
  // An invited teammate authenticates into their own fresh org, which has no
  // subscription of its own, before accepting. Gating this would make it
  // impossible to join an org that is paying.
  '/invite/',
  // The terms step a new account sees right after signing in. It comes before
  // the trial starts, so the account has no subscription yet by design.
  '/accept-terms',
  // Reachable while an org is soft-deleted so its owner can still restore it.
  '/account-deleted',
  // The branded checkout page. Same reason as /start-trial: an org reaches it
  // precisely because it has no subscription yet, so gating it on having one
  // would make the page unreachable by everyone it exists for.
  '/checkout',
]

export function isAccessExempt(pathname: string): boolean {
  return ACCESS_EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(p))
}

/**
 * Whether the org is inside the app's own card-free trial, with no Stripe
 * subscription behind it. Such an org has access but is still allowed through
 * /checkout, so it can subscribe early; an org with a real subscription is not,
 * because a second checkout would create a second subscription.
 */
export async function orgIsOnAppTrial(orgId: number): Promise<boolean> {
  if (getDeploymentMode() === 'self-hosted') return false
  const sub = await getSubscription(orgId)
  return !!sub && isAppManagedTrial(sub)
}
