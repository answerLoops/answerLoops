export const TRIAL_DAYS = 14

export type PlanId = 'standard' | 'pro' | 'enterprise'

// Minimum annual discount; annualMonthlyPrice also rounds down to whole dollars.
export const ANNUAL_DISCOUNT_PCT = 20

export type BillingInterval = 'monthly' | 'annual'

/**
 * Narrows an untrusted string to a billing interval, or null if it is not one.
 *
 * The value travels in a query string from the pricing page through sign-in, so
 * it is caller-supplied by the time checkout sees it. Everything downstream
 * chooses a Stripe price id from it, and that decides what somebody is charged.
 */
export function parseBillingInterval(
  value: string | null | undefined,
): BillingInterval | null {
  return value === 'monthly' || value === 'annual' ? value : null
}

export interface Plan {
  id: PlanId
  name: string
  deflectionsPerMonth: number | null // null = unlimited
  priceMonthly: number // USD cents, 0 = free
  // Cents charged per 100 deflections used beyond deflectionsPerMonth, or null
  // for a hard cap: once the included quota is spent, no further deflections go
  // out until the period resets or the org upgrades. A non-null rate is a soft
  // cap — deflections keep flowing past the quota and the overage is billed.
  //
  // The metered charge is not wired to Stripe yet: a soft-cap plan currently
  // keeps answering past its quota for free, and the dashboard shows the
  // overage count so the number is visible before the billing lands. Enforcing
  // the charge is a follow-up — until then this field only drives which plans
  // block at the limit and what the UI says.
  overageRatePer100Cents: number | null
  stripePriceId: string | null // monthly price; null = not configured
  stripePriceIdAnnual: string | null // annual price; null = not configured
}

// Annual plans apply at least the stated discount and round the monthly
// equivalent down to a whole dollar. Annual billing charges twelve times it.
export function annualMonthlyPrice(plan: Plan): number {
  return (
    Math.floor((plan.priceMonthly * (1 - ANNUAL_DISCOUNT_PCT / 100)) / 100) *
    100
  )
}

export const PLANS: Record<PlanId, Plan> = {
  // Each plan reads STRIPE_PRICE_<ID> for its own id. That alignment is
  // load-bearing rather than tidiness: the 2026-07-29 rename (pro→standard,
  // scale→pro) deliberately left the old var names in place on the reasoning
  // that a var name is just a label on an opaque Stripe id. Deployments were
  // then configured from the plan names instead, so the code was reading
  // STRIPE_PRICE_PRO for Standard while the environment had it set to the Pro
  // price — Standard billed the wrong amount, and Pro read an unset
  // STRIPE_PRICE_SCALE and could not be purchased at all.
  //
  // Keep var name and plan id identical. A mismatch here is a silent billing
  // error on one plan and a broken checkout on another, and neither surfaces
  // until a customer hits it.
  standard: {
    id: 'standard',
    // Was id 'pro' / name "Pro" — renamed 2026-07-29 so the id matches the
    // display name shipped in PR #204.
    name: 'Standard',
    deflectionsPerMonth: 500,
    priceMonthly: 4900,
    overageRatePer100Cents: null, // hard cap
    stripePriceId: process.env.STRIPE_PRICE_STANDARD ?? null,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_STANDARD_ANNUAL ?? null,
  },
  pro: {
    id: 'pro',
    // Was id 'scale' / name "Scale" — renamed 2026-07-29. This is the
    // *new* meaning of 'pro'; see plans.ts module comment history if this
    // reads as a regression of anything — it isn't.
    name: 'Pro',
    deflectionsPerMonth: 3000,
    priceMonthly: 14900,
    overageRatePer100Cents: 500, // soft cap: $5 per 100 deflections over quota
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? null,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    deflectionsPerMonth: null,
    priceMonthly: 49900,
    overageRatePer100Cents: null, // unlimited — no quota to exceed
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE ?? null,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL ?? null,
  },
}

export const ORDERED_PLANS: Plan[] = [
  PLANS.standard,
  PLANS.pro,
  PLANS.enterprise,
]

/**
 * The plan the product recommends: the "Most popular" pricing card, and what
 * /checkout preselects for someone who arrives without having chosen.
 *
 * One constant rather than the string repeated in both places. They are the
 * same decision — the card a visitor is steered toward and the plan waiting for
 * them at checkout — and letting them drift apart would highlight one plan on
 * the way in and preselect a different one at the till.
 */
export const HIGHLIGHTED_PLAN_ID = 'pro'

/**
 * The one place a billing interval turns into a Stripe price id.
 *
 * Kept as a single function rather than letting call sites reach for the field
 * they want: picking the wrong one is a silent billing error, charging monthly
 * to somebody who chose annual or the reverse, and it surfaces on a customer's
 * card rather than in a test.
 *
 * Returns null when that interval has no price configured, which callers must
 * treat as "cannot sell this", not as a reason to fall back to the other
 * interval — being charged a different amount than the one displayed is worse
 * than being told checkout is unavailable.
 */
export function stripePriceFor(
  plan: Plan,
  interval: BillingInterval,
): string | null {
  return interval === 'annual' ? plan.stripePriceIdAnnual : plan.stripePriceId
}

/** Total charged per year on the annual price, in cents. Display and tests. */
export function annualTotalPrice(plan: Plan): number {
  return annualMonthlyPrice(plan) * 12
}

// There is no free tier. Every subscription starts on one of the three paid
// plans above with a 14-day Stripe trial attached to it (checkout.session.completed
// creates the row with status='trialing' and the plan the customer picked —
// see app/api/billing/webhook/route.ts). An org with no subscription row, or
// an unrecognized/legacy planId string, has no plan at all: getPlan returns
// null rather than falling back to a free plan, and callers must treat null
// as zero access.
export function getPlan(id: PlanId | string | null | undefined): Plan | null {
  return id ? PLANS[id as PlanId] ?? null : null
}

/**
 * Stripe subscription statuses that still grant plan access. past_due is a
 * short dunning grace period (Stripe keeps retrying the card); everything
 * else — canceled, unpaid, incomplete, incomplete_expired, paused, or no
 * subscription row at all — has zero access. There is no free tier: losing
 * payment status means losing service, immediately, not degrading to a free
 * plan.
 */
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function hasActiveAccess(status: string | null | undefined): boolean {
  return !!status && ACTIVE_SUBSCRIPTION_STATUSES.has(status)
}

/**
 * Resolves a Stripe price id back to the plan that sells it.
 *
 * Both intervals count. The webhook reads whichever price id Stripe put on the
 * subscription item, and for an annual customer that is the annual id — so
 * matching only the monthly id leaves every annual subscription unresolvable,
 * which surfaces as a subscription.updated event that cannot name a plan.
 *
 * Unconfigured price ids are null, and a null price id must never match: an org
 * whose plan has no annual price configured would otherwise resolve to that
 * plan on any event carrying no price at all.
 */
export function priceIdToPlan(priceId: string): Plan | null {
  if (!priceId) return null
  return (
    Object.values(PLANS).find(
      (p) => p.stripePriceId === priceId || p.stripePriceIdAnnual === priceId,
    ) ?? null
  )
}

/**
 * Whether the org has used its full included deflection quota this period.
 *
 * This is the "past the included amount" predicate — it says nothing about
 * whether further deflections are blocked. On a hard-cap plan it also means
 * "blocked" (see `blocksAtLimit`); on a soft-cap plan it just means the
 * overage meter has started.
 */
export function isOverLimit(deflections: number, plan: Plan): boolean {
  if (plan.deflectionsPerMonth === null) return false
  return deflections >= plan.deflectionsPerMonth
}

/**
 * Whether reaching the included quota stops further deflections going out.
 *
 * True only for a metered plan with a hard cap (no overage rate). A soft-cap
 * plan keeps answering past its quota, and an unlimited plan has no quota to
 * reach. Enforcement paths gate on `blocksAtLimit(plan) && isOverLimit(...)`
 * so a soft-cap org is never cut off mid-period.
 */
export function blocksAtLimit(plan: Plan): boolean {
  return (
    plan.deflectionsPerMonth !== null && plan.overageRatePer100Cents === null
  )
}

/**
 * Deflections used beyond the included quota this period, floored at zero.
 * Zero for unlimited plans and for anyone still under quota.
 */
export function overageUnits(deflections: number, plan: Plan): number {
  if (plan.deflectionsPerMonth === null) return 0
  return Math.max(0, deflections - plan.deflectionsPerMonth)
}

/**
 * What the overage used so far this period will cost, in cents, on a soft-cap
 * plan. Billed per whole or partial block of 100. Zero on hard-cap and
 * unlimited plans. (Display only until metered billing is wired to Stripe.)
 */
export function overageCostCents(deflections: number, plan: Plan): number {
  if (plan.overageRatePer100Cents === null) return 0
  const units = overageUnits(deflections, plan)
  return Math.ceil(units / 100) * plan.overageRatePer100Cents
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export type DeploymentMode = 'cloud' | 'self-hosted'

/**
 * Explicit deployment-mode signal, set once via env rather than inferred.
 * Defaults to 'self-hosted' when unset — a fresh self-hosted clone with no
 * env configured should never be mistaken for a broken cloud deployment.
 * `DEPLOYMENT_MODE=cloud` must be set on the managed answerloops.com prod
 * environment. Previously "self-hosted" was inferred from the absence of
 * `STRIPE_SECRET_KEY`, which meant a misconfigured or rotated key on cloud
 * silently degraded every paying org to unmetered/unlimited — the same
 * branch a self-hoster gets on purpose. This flag decouples the two.
 */
export function getDeploymentMode(): DeploymentMode {
  return process.env.DEPLOYMENT_MODE === 'cloud' ? 'cloud' : 'self-hosted'
}

/**
 * True when this is a cloud deployment that is missing its Stripe key — a
 * real misconfiguration, not a valid unmetered state. Callers must surface
 * this loudly rather than silently falling back to the self-hosted branch.
 */
export function isCloudMisconfigured(): boolean {
  return getDeploymentMode() === 'cloud' && !stripeConfigured()
}
