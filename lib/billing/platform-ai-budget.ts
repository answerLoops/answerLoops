import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { getSubscription } from '@/lib/db/queries/billing'
import { getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { hasOwnEmbeddingConfig } from '@/lib/ai/embedding-pin'
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

export interface BudgetCheckOptions {
  /** The workspace runs answers on its own key; shapes the exhausted message. */
  ownChatProvider?: boolean
}

/**
 * Refuses a platform call once the included usage for this kind is used up.
 * Checked before the call and recorded after it, so calls already in flight
 * when the budget is reached can overshoot it by roughly one call each.
 */
export async function assertBudget(orgId: number, kind: BudgetKind, tier: BudgetTier, options: BudgetCheckOptions = {}): Promise<void> {
  const budget = getBudgetMicros(tier, kind)
  if (budget <= 0) throw new PlatformBudgetExhaustedError(orgId, kind, tier, options)
  const spent = await getSpendMicros(orgId, tier, kind)
  if (spent >= budget) throw new PlatformBudgetExhaustedError(orgId, kind, tier, options)
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
  // Whether this kind of call runs on included usage at all (false when the
  // workspace's own provider handles it).
  included: boolean
  warning: boolean
  exhausted: boolean
}

export interface BudgetStatus {
  tier: BudgetTier
  // The workspace runs answers on its own key (only knowledge-base
  // processing can be on included usage).
  ownChatProvider: boolean
  chat: KindStatus
  embedding: KindStatus
  // The models the workspace runs on while it has no provider of its own,
  // shown read-only in AI settings. Null when that role is unusable.
  models: Record<PlatformRole, string | null>
}

const NOT_INCLUDED: KindStatus = { included: false, warning: false, exhausted: false }

function kindStatus(spent: number, budget: number): KindStatus {
  if (budget <= 0) return { included: true, warning: true, exhausted: true }
  return { included: true, warning: spent >= budget * BUDGET_WARNING_FRACTION, exhausted: spent >= budget }
}

type StatusRow = { chat: number | string | null; embedding: number | string | null }

/**
 * Where a hosted workspace stands on included usage, per kind of call:
 * answers count only without its own chat provider, knowledge-base
 * processing only without its own embedding config (a non-OpenAI chat key
 * alone doesn't embed). Flags only, never amounts or fractions, so nothing
 * downstream can render or back out a budget.
 */
export async function getBudgetStatus(orgId: number): Promise<BudgetStatus | null> {
  if (getDeploymentMode() !== 'cloud') return null
  const cfg = await getOrgAIConfig(orgId).catch(() => null)
  const ownChatProvider = !!(cfg?.chat_api_key || cfg?.chat_provider === 'openai-compatible')
  const embeddingIncluded = !hasOwnEmbeddingConfig(cfg)
  if (ownChatProvider && !embeddingIncluded) return null
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
    ownChatProvider,
    chat: ownChatProvider ? NOT_INCLUDED : kindStatus(Number(rows[0]?.chat ?? 0), getBudgetMicros(tier, 'chat')),
    embedding: embeddingIncluded ? kindStatus(Number(rows[0]?.embedding ?? 0), getBudgetMicros(tier, 'embedding')) : NOT_INCLUDED,
    models: {
      chat: getPlatformModel('chat'),
      fast: getPlatformModel('fast'),
      embedding: getPlatformModel('embedding'),
    },
  }
}
