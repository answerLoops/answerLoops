import type { BudgetKind, BudgetTier } from '@/lib/ai/errors'
import { getDeploymentMode, type PlanId } from '@/lib/billing/plans'
import { logger } from '@/lib/logger'

const MOD = 'billing/platform-ai-budget-config'

/**
 * Included platform AI usage per workspace, in US dollars, set only on the
 * hosting platform. There are deliberately no defaults here: an unset
 * variable means the platform covers nothing for that tier and kind.
 * Trial budgets cover the whole trial; plan budgets reset each UTC month.
 */
export const BUDGET_ENV_VARS: Readonly<Record<BudgetTier, Record<BudgetKind, string>>> = {
  trial: { chat: 'PLATFORM_AI_TRIAL_CHAT_BUDGET_USD', embedding: 'PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD' },
  plan: { chat: 'PLATFORM_AI_PLAN_CHAT_BUDGET_USD', embedding: 'PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD' },
}

const TIERS: readonly BudgetTier[] = ['trial', 'plan']
const KINDS: readonly BudgetKind[] = ['chat', 'embedding']

/** Dollars to micro-dollars, or null when the value is missing or not a finite, non-negative number. */
export function parseBudgetUsd(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null
  const usd = Number(raw.trim())
  if (!Number.isFinite(usd) || usd < 0) return null
  return Math.round(usd * 1_000_000)
}

type Budgets = Record<BudgetTier, Record<BudgetKind, number>>

export function readBudgets(env: Readonly<Record<string, string | undefined>> = process.env): Budgets {
  const out: Budgets = { trial: { chat: 0, embedding: 0 }, plan: { chat: 0, embedding: 0 } }
  for (const tier of TIERS) {
    for (const kind of KINDS) {
      out[tier][kind] = parseBudgetUsd(env[BUDGET_ENV_VARS[tier][kind]]) ?? 0
    }
  }
  return out
}

/**
 * The included chat (answers) budget for each paid plan, so a higher plan
 * covers more included answers. Only chat is split by plan: knowledge-base
 * processing (embedding) keeps one shared budget, and the trial keeps one
 * budget, because the trial is not on any plan.
 *
 * Each plan reads the variable named for its own id, the same alignment
 * lib/billing/plans.ts relies on for Stripe price ids. Adding a plan without a
 * variable here is a compile error.
 *
 * A plan whose variable is unset reads the single paid-plan chat budget
 * (BUDGET_ENV_VARS.plan.chat), so a deployment that has not set these yet
 * keeps answering at the amount it already had instead of switching AI off for
 * customers who are paying. A variable that is set but unusable is a zero
 * budget, not a fallback: a typo should be visible, not quietly papered over.
 */
export const PLAN_CHAT_BUDGET_ENV_VARS: Readonly<Record<PlanId, string>> = {
  standard: 'PLATFORM_AI_STANDARD_CHAT_BUDGET_USD',
  pro: 'PLATFORM_AI_PRO_CHAT_BUDGET_USD',
  enterprise: 'PLATFORM_AI_ENTERPRISE_CHAT_BUDGET_USD',
}

function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && Object.hasOwn(PLAN_CHAT_BUDGET_ENV_VARS, value)
}

let cached: Budgets | null = null
const logged = new Set<string>()

function logOnce(key: string, level: 'warn' | 'error', message: string, fields: Record<string, unknown>): void {
  if (logged.has(key)) return
  logged.add(key)
  logger[level](message, { module: MOD, ...fields })
}

/** The paid-plan chat budget with no plan to go by: the single shared variable. */
function sharedPlanChatMicros(): number {
  const name = BUDGET_ENV_VARS.plan.chat
  if (getDeploymentMode() === 'cloud' && parseBudgetUsd(process.env[name]) === null) {
    logOnce(`unusable:${name}`, 'error', 'platform AI budget variable missing or invalid; included usage is off for it', { variable: name })
  }
  return cached?.plan.chat ?? 0
}

function planChatMicros(planId: PlanId): number {
  const name = PLAN_CHAT_BUDGET_ENV_VARS[planId]
  const raw = process.env[name]
  if (raw !== undefined && raw.trim() !== '') {
    const micros = parseBudgetUsd(raw)
    if (micros === null) {
      if (getDeploymentMode() === 'cloud') {
        logOnce(`unusable:${name}`, 'error', 'platform AI budget variable invalid; included usage is off for it', { variable: name })
      }
      return 0
    }
    return micros
  }
  const shared = sharedPlanChatMicros()
  if (getDeploymentMode() === 'cloud' && parseBudgetUsd(process.env[BUDGET_ENV_VARS.plan.chat]) !== null) {
    logOnce(`fallback:${planId}`, 'warn', 'plan chat budget variable not set; using the shared paid-plan budget', {
      variable: name,
      fallbackVariable: BUDGET_ENV_VARS.plan.chat,
    })
  }
  return shared
}

/**
 * The included budget, in micro-dollars, for a kind of call. `planId` only
 * matters for paid-plan chat: pass the workspace's plan to get that plan's
 * budget. Without one (or with an id that is not a plan we sell) the single
 * shared paid-plan budget applies.
 */
export function getBudgetMicros(tier: BudgetTier, kind: BudgetKind, planId?: PlanId | null): number {
  if (!cached) {
    cached = readBudgets(process.env)
    if (getDeploymentMode() === 'cloud') {
      for (const t of TIERS) {
        for (const k of KINDS) {
          // Paid-plan chat is checked when it is read, because which variable
          // matters depends on the plan.
          if (t === 'plan' && k === 'chat') continue
          const name = BUDGET_ENV_VARS[t][k]
          if (parseBudgetUsd(process.env[name]) === null) {
            logger.error('platform AI budget variable missing or invalid; included usage is off for it', { module: MOD, variable: name })
          }
        }
      }
    }
  }
  if (tier === 'plan' && kind === 'chat') {
    return isPlanId(planId) ? planChatMicros(planId) : sharedPlanChatMicros()
  }
  return cached[tier][kind]
}

export function resetBudgetConfigCache(): void {
  cached = null
  logged.clear()
}
