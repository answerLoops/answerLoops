import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { getSubscription } from '@/lib/db/queries/billing'
import { orgHasAIKey } from '@/lib/db/queries/ai-config'
import { getDeploymentMode } from '@/lib/billing/plans'
import { getBudgetMicros } from '@/lib/billing/platform-ai-budget-config'
import { PlatformBudgetExhaustedError, type BudgetKind, type BudgetTier } from '@/lib/ai/errors'
import { getPlatformModel, type PlatformRole } from '@/lib/ai/platform-models'
import { logger } from '@/lib/logger'

const MOD = 'billing/platform-ai-budget'

/**
 * Included platform AI usage per workspace. A hosted workspace without its
 * own provider runs on answerLoops' key up to a budget per kind of call:
 * during the trial the budget covers the whole trial (spend on orgs), on a
 * paid plan it resets each UTC calendar month (spend in platform_ai_usage),
 * for monthly and annual plans alike. Amounts come from the environment
 * (platform-ai-budget-config.ts) and never leave this module.
 */

export const BUDGET_WARNING_FRACTION = 0.8

const TRIAL_COLUMN: Record<BudgetKind, string> = {
  chat: 'trial_chat_spend_micros',
  embedding: 'trial_embedding_spend_micros',
}

const PLAN_COLUMN: Record<BudgetKind, string> = {
  chat: 'chat_spend_micros',
  embedding: 'embedding_spend_micros',
}

/** UTC calendar month, 'YYYY-MM'. */
export function currentPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

export function tierForStatus(status: string | null | undefined): BudgetTier | null {
  if (status === 'trialing') return 'trial'
  if (status === 'active' || status === 'past_due') return 'plan'
  return null
}

export async function getBillingTier(orgId: number): Promise<BudgetTier | null> {
  const sub = await getSubscription(orgId)
  return tierForStatus(sub?.status)
}

type SpentRow = { spent: number | string | null }

export async function getSpendMicros(orgId: number, tier: BudgetTier, kind: BudgetKind, now: Date = new Date()): Promise<number> {
  const rows = tier === 'trial'
    ? ((await getDb().execute(sql`
        SELECT ${sql.raw(TRIAL_COLUMN[kind])} AS spent FROM orgs WHERE id = ${orgId}
      `)) as unknown as SpentRow[])
    : ((await getDb().execute(sql`
        SELECT ${sql.raw(PLAN_COLUMN[kind])} AS spent FROM platform_ai_usage
        WHERE org_id = ${orgId} AND period = ${currentPeriod(now)}
      `)) as unknown as SpentRow[])
  return Number(rows[0]?.spent ?? 0)
}

export async function assertBudget(orgId: number, kind: BudgetKind, tier: BudgetTier): Promise<void> {
  const budget = getBudgetMicros(tier, kind)
  if (budget <= 0) throw new PlatformBudgetExhaustedError(orgId, kind, tier)
  const spent = await getSpendMicros(orgId, tier, kind)
  if (spent >= budget) throw new PlatformBudgetExhaustedError(orgId, kind, tier)
}

/**
 * Adds one call's cost. A single statement per tier, so concurrent calls for
 * the same workspace serialize on Postgres's row lock and sum exactly. Logs a
 * warning when a call pushes spend across 80% or across the budget.
 */
export async function recordSpend(orgId: number, kind: BudgetKind, tier: BudgetTier, micros: number, now: Date = new Date()): Promise<void> {
  if (micros <= 0) return
  let rows: SpentRow[]
  if (tier === 'trial') {
    const col = sql.raw(TRIAL_COLUMN[kind])
    rows = (await getDb().execute(sql`
      UPDATE orgs SET ${col} = ${col} + ${micros} WHERE id = ${orgId} RETURNING ${col} AS spent
    `)) as unknown as SpentRow[]
  } else {
    const col = sql.raw(PLAN_COLUMN[kind])
    rows = (await getDb().execute(sql`
      INSERT INTO platform_ai_usage (org_id, period, ${col}) VALUES (${orgId}, ${currentPeriod(now)}, ${micros})
      ON CONFLICT (org_id, period) DO UPDATE SET ${col} = platform_ai_usage.${col} + EXCLUDED.${col}
      RETURNING ${col} AS spent
    `)) as unknown as SpentRow[]
  }

  const budget = getBudgetMicros(tier, kind)
  if (budget <= 0) return
  const after = Number(rows[0]?.spent ?? 0)
  const before = after - micros
  const line = budget * BUDGET_WARNING_FRACTION
  if (before < budget && after >= budget) {
    logger.warn('platform AI budget exhausted', { module: MOD, orgId, kind, tier })
  } else if (before < line && after >= line) {
    logger.warn('platform AI budget crossed 80%', { module: MOD, orgId, kind, tier })
  }
}

export interface KindStatus {
  fraction: number
  warning: boolean
  exhausted: boolean
}

export interface BudgetStatus {
  tier: BudgetTier
  chat: KindStatus
  embedding: KindStatus
  // The models the workspace runs on while it has no provider of its own,
  // shown read-only in AI settings. Null when that role is unusable.
  models: Record<PlatformRole, string | null>
}

function kindStatus(spent: number, budget: number): KindStatus {
  if (budget <= 0) return { fraction: 1, warning: true, exhausted: true }
  const fraction = spent / budget
  return { fraction, warning: fraction >= BUDGET_WARNING_FRACTION, exhausted: spent >= budget }
}

type StatusRow = { chat: number | string | null; embedding: number | string | null }

/**
 * Where a hosted workspace without its own key stands against its included
 * usage. Fractions and flags only, so nothing downstream can render an amount.
 */
export async function getBudgetStatus(orgId: number): Promise<BudgetStatus | null> {
  if (getDeploymentMode() !== 'cloud') return null
  if (await orgHasAIKey(orgId)) return null
  const tier = await getBillingTier(orgId)
  if (!tier) return null

  const rows = tier === 'trial'
    ? ((await getDb().execute(sql`
        SELECT trial_chat_spend_micros AS chat, trial_embedding_spend_micros AS embedding FROM orgs WHERE id = ${orgId}
      `)) as unknown as StatusRow[])
    : ((await getDb().execute(sql`
        SELECT chat_spend_micros AS chat, embedding_spend_micros AS embedding FROM platform_ai_usage
        WHERE org_id = ${orgId} AND period = ${currentPeriod()}
      `)) as unknown as StatusRow[])

  return {
    tier,
    chat: kindStatus(Number(rows[0]?.chat ?? 0), getBudgetMicros(tier, 'chat')),
    embedding: kindStatus(Number(rows[0]?.embedding ?? 0), getBudgetMicros(tier, 'embedding')),
    models: {
      chat: getPlatformModel('chat'),
      fast: getPlatformModel('fast'),
      embedding: getPlatformModel('embedding'),
    },
  }
}
