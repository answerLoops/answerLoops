import { getDeploymentMode, type PlanId } from './plans'

export type Feature =
  | 'discord_integration'
  | 'slack_integration'
  | 'google_chat_integration'
  | 'discourse_integration'
  | 'circle_integration'
  | 'csat_scoring'
  | 'human_escalation'
  | 'simulation'
  | 'knowledge_gap_dashboard'
  | 'custom_ai_model_config'
  | 'csv_export'
  | 'white_label_widget'

const STANDARD_FEATURES: Feature[] = ['discord_integration', 'slack_integration', 'google_chat_integration', 'discourse_integration', 'circle_integration', 'csv_export', 'white_label_widget']
const PRO_FEATURES: Feature[] = [...STANDARD_FEATURES, 'csat_scoring', 'human_escalation', 'simulation', 'knowledge_gap_dashboard']
const ENTERPRISE_FEATURES: Feature[] = [...PRO_FEATURES, 'custom_ai_model_config']

const FEATURES_BY_PLAN: Record<PlanId, Feature[]> = {
  standard: STANDARD_FEATURES,
  pro: PRO_FEATURES,
  enterprise: ENTERPRISE_FEATURES,
}

/**
 * Pure, env-free entitlement check against an already-resolved planId
 * string (as returned by /api/billing/status: a real PlanId on cloud,
 * or 'self-hosted' / 'misconfigured'). Safe to call from Client Components
 * — unlike `hasFeature`/`orgHasFeature` (in entitlements-server.ts), it
 * never reads `process.env`, which is unset in the browser bundle and
 * would otherwise make every check look self-hosted (i.e. always
 * unlocked) regardless of real plan. This file must stay free of any
 * `lib/db/*` import — orgHasFeature's DB dependency is what pulled the
 * postgres driver into the client bundle when it lived here.
 */
export function planIncludesFeature(planId: PlanId | string, feature: Feature): boolean {
  if (planId === 'self-hosted') return true
  const features = FEATURES_BY_PLAN[planId as PlanId]
  return features ? features.includes(feature) : false
}

/**
 * Self-hosted deployments are never gated — the org already brings its own
 * AI/DB/hosting, so there is no feature list to enforce there. Gating only
 * applies to the managed cloud SaaS, where plan tier determines what a
 * `planId` unlocks. Server-only — reads `process.env` via getDeploymentMode.
 */
export function hasFeature(planId: PlanId | string, feature: Feature): boolean {
  if (getDeploymentMode() === 'self-hosted') return true
  return planIncludesFeature(planId, feature)
}

/** Lowest plan (by ORDERED_PLANS order) that unlocks a feature, for upgrade-prompt copy. */
export function planRequiredFor(feature: Feature): PlanId {
  if (STANDARD_FEATURES.includes(feature)) return 'standard'
  if (PRO_FEATURES.includes(feature)) return 'pro'
  return 'enterprise'
}

const RATE_LIMIT_PER_MINUTE: Record<PlanId, number> = {
  standard: 50,
  pro: 150,
  // Deliberately held at 300, not the researched 600, until the load-test
  // roadmap item verifies the Neon/Railway setup under real concurrency —
  // see the Roadmap page's "Load test /api/mcp and /api/agent/*" item
  // (2026-07-29). Revisit once that lands.
  enterprise: 300,
}

/**
 * Per-org-per-minute ceiling on /api/mcp and /api/v1/agent/* — both routes ran
 * a single flat 60/min for every plan until now. Each paid tier now gets a
 * real, enforced ceiling rather than a marketing-only claim. Pure, env-free
 * — safe to call from either surface's route handler directly.
 */
export function rateLimitPerMinute(planId: PlanId | string): number {
  return RATE_LIMIT_PER_MINUTE[planId as PlanId] ?? 0
}
