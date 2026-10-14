import type { BudgetKind, BudgetTier } from '@/lib/ai/errors'
import { getDeploymentMode } from '@/lib/billing/plans'
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

let cached: Budgets | null = null

export function getBudgetMicros(tier: BudgetTier, kind: BudgetKind): number {
  if (!cached) {
    cached = readBudgets(process.env)
    if (getDeploymentMode() === 'cloud') {
      for (const t of TIERS) {
        for (const k of KINDS) {
          const name = BUDGET_ENV_VARS[t][k]
          if (parseBudgetUsd(process.env[name]) === null) {
            logger.error('platform AI budget variable missing or invalid; included usage is off for it', { module: MOD, variable: name })
          }
        }
      }
    }
  }
  return cached[tier][kind]
}

export function resetBudgetConfigCache(): void {
  cached = null
}
