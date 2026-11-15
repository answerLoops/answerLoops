import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

// Included AI usage is budgeted per plan: a Pro workspace gets more included
// answers than a Standard one. The trial keeps one budget, the embedding
// (knowledge-base processing) budget stays shared, and an unset per-plan
// variable falls back to the single paid-plan budget so deploying before the
// variables are set cannot switch AI off for paying customers. Values here are
// arbitrary and only for arithmetic.

const ALL_VARS = [
  'PLATFORM_AI_TRIAL_CHAT_BUDGET_USD', 'PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD',
  'PLATFORM_AI_PLAN_CHAT_BUDGET_USD', 'PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD',
  'PLATFORM_AI_STANDARD_CHAT_BUDGET_USD', 'PLATFORM_AI_PRO_CHAT_BUDGET_USD', 'PLATFORM_AI_ENTERPRISE_CHAT_BUDGET_USD',
]

function stubBudgetEnv(budgets: Record<string, string> = {}, deployment = 'cloud') {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv('DEPLOYMENT_MODE', deployment)
  for (const name of ALL_VARS) vi.stubEnv(name, '')
  for (const [k, v] of Object.entries(budgets)) vi.stubEnv(k, v)
}

// Variables these tests are not about are set to valid values, so the errors
// the config logs for an unusable variable at startup do not blur the counts
// asserted on below.
const UNRELATED_DEFAULTS = {
  PLATFORM_AI_TRIAL_CHAT_BUDGET_USD: '1',
  PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD: '1',
  PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD: '1',
}

async function loadConfig(budgets: Record<string, string> = {}, deployment = 'cloud') {
  stubBudgetEnv({ ...UNRELATED_DEFAULTS, ...budgets }, deployment)
  const error = vi.fn()
  const warn = vi.fn()
  vi.doMock('@/lib/logger', () => ({ logger: { error, warn, info: vi.fn(), debug: vi.fn() } }))
  const mod = await import('@/lib/billing/platform-ai-budget-config')
  return { mod, error, warn }
}

describe('per-plan chat budget variables', () => {
  it('uses the agreed variable names, one per plan', async () => {
    const { mod } = await loadConfig()
    expect(mod.PLAN_CHAT_BUDGET_ENV_VARS).toEqual({
      standard: 'PLATFORM_AI_STANDARD_CHAT_BUDGET_USD',
      pro: 'PLATFORM_AI_PRO_CHAT_BUDGET_USD',
      enterprise: 'PLATFORM_AI_ENTERPRISE_CHAT_BUDGET_USD',
    })
  })

  it('has a variable for every plan the product sells', async () => {
    const { mod } = await loadConfig()
    const { PLANS } = await import('@/lib/billing/plans')
    expect(Object.keys(mod.PLAN_CHAT_BUDGET_ENV_VARS).sort()).toEqual(Object.keys(PLANS).sort())
  })
})

describe('getBudgetMicros by plan', () => {
  it('gives each plan its own chat budget', async () => {
    const { mod } = await loadConfig({
      PLATFORM_AI_STANDARD_CHAT_BUDGET_USD: '15',
      PLATFORM_AI_PRO_CHAT_BUDGET_USD: '60',
      PLATFORM_AI_ENTERPRISE_CHAT_BUDGET_USD: '250',
    })
    expect(mod.getBudgetMicros('plan', 'chat', 'standard')).toBe(15_000_000)
    expect(mod.getBudgetMicros('plan', 'chat', 'pro')).toBe(60_000_000)
    expect(mod.getBudgetMicros('plan', 'chat', 'enterprise')).toBe(250_000_000)
  })

  it('a per-plan value wins over the single paid-plan budget', async () => {
    const { mod } = await loadConfig({
      PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '5',
      PLATFORM_AI_PRO_CHAT_BUDGET_USD: '60',
    })
    expect(mod.getBudgetMicros('plan', 'chat', 'pro')).toBe(60_000_000)
  })

  it('an explicit zero is a real zero budget and does not fall back', async () => {
    const { mod, warn } = await loadConfig({
      PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '5',
      PLATFORM_AI_STANDARD_CHAT_BUDGET_USD: '0',
    })
    expect(mod.getBudgetMicros('plan', 'chat', 'standard')).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('an unset per-plan variable falls back to the single paid-plan budget and says so, once per plan', async () => {
    const { mod, warn, error } = await loadConfig({ PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '5' })
    expect(mod.getBudgetMicros('plan', 'chat', 'pro')).toBe(5_000_000)
    expect(mod.getBudgetMicros('plan', 'chat', 'pro')).toBe(5_000_000)
    expect(mod.getBudgetMicros('plan', 'chat', 'standard')).toBe(5_000_000)
    expect(error).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(warn.mock.calls[0])).toContain('PLATFORM_AI_PRO_CHAT_BUDGET_USD')
  })

  it('an unusable per-plan value is a zero budget and an error, never a silent fallback', async () => {
    const { mod, error } = await loadConfig({
      PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '5',
      PLATFORM_AI_PRO_CHAT_BUDGET_USD: 'oops',
    })
    expect(mod.getBudgetMicros('plan', 'chat', 'pro')).toBe(0)
    expect(mod.getBudgetMicros('plan', 'chat', 'pro')).toBe(0)
    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls[0])).toContain('PLATFORM_AI_PRO_CHAT_BUDGET_USD')
  })

  it('with neither a per-plan nor a paid-plan value the budget is zero and logged', async () => {
    const { mod, error } = await loadConfig()
    expect(mod.getBudgetMicros('plan', 'chat', 'enterprise')).toBe(0)
    expect(error).toHaveBeenCalled()
  })

  it('without a plan it reads the single paid-plan budget', async () => {
    const { mod } = await loadConfig({ PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '5', PLATFORM_AI_PRO_CHAT_BUDGET_USD: '60' })
    expect(mod.getBudgetMicros('plan', 'chat')).toBe(5_000_000)
    expect(mod.getBudgetMicros('plan', 'chat', null)).toBe(5_000_000)
  })

  it('an unrecognised plan id reads the single paid-plan budget', async () => {
    const { mod } = await loadConfig({ PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '5' })
    expect(mod.getBudgetMicros('plan', 'chat', 'legacy-plan' as never)).toBe(5_000_000)
  })

  it('the trial budget is the same whatever the plan', async () => {
    const { mod } = await loadConfig({ PLATFORM_AI_TRIAL_CHAT_BUDGET_USD: '4', PLATFORM_AI_PRO_CHAT_BUDGET_USD: '60' })
    expect(mod.getBudgetMicros('trial', 'chat', 'pro')).toBe(4_000_000)
    expect(mod.getBudgetMicros('trial', 'chat')).toBe(4_000_000)
  })

  it('the embedding budget is shared across plans', async () => {
    const { mod } = await loadConfig({ PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD: '2', PLATFORM_AI_PRO_CHAT_BUDGET_USD: '60' })
    expect(mod.getBudgetMicros('plan', 'embedding', 'standard')).toBe(2_000_000)
    expect(mod.getBudgetMicros('plan', 'embedding', 'pro')).toBe(2_000_000)
  })

  it('does not log on self-hosted', async () => {
    const { mod, error, warn } = await loadConfig({}, '')
    mod.getBudgetMicros('plan', 'chat', 'pro')
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('plan-aware budget checks', () => {
  async function loadBudget(opts: { budgets?: Record<string, string>; rows?: Record<string, unknown>[]; subscription?: Record<string, unknown> | null }) {
    stubBudgetEnv(opts.budgets ?? {})
    const warn = vi.fn()
    const fakeDb = drizzle(async () => ({ rows: opts.rows ?? [] }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    vi.doMock('@/lib/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    vi.doMock('@/lib/db/queries/billing', () => ({
      getSubscription: async () => (opts.subscription === undefined ? { status: 'active', planId: 'pro' } : opts.subscription),
    }))
    vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => null }))
    const mod = await import('@/lib/billing/platform-ai-budget')
    return { mod, warn }
  }

  const budgets = {
    PLATFORM_AI_STANDARD_CHAT_BUDGET_USD: '1',
    PLATFORM_AI_PRO_CHAT_BUDGET_USD: '5',
    PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD: '1',
  }

  beforeEach(() => vi.resetModules())

  it('the same spend exhausts a Standard workspace but not a Pro one', async () => {
    const { mod } = await loadBudget({ budgets, rows: [{ spent: 1_500_000 }] })
    await expect(mod.assertBudget(1, 'chat', 'plan', { planId: 'standard' })).rejects.toMatchObject({ name: 'PlatformBudgetExhaustedError', kind: 'chat', tier: 'plan' })
    await expect(mod.assertBudget(1, 'chat', 'plan', { planId: 'pro' })).resolves.toBeUndefined()
  })

  it('keeps passing ownChatProvider alongside the plan', async () => {
    const { mod } = await loadBudget({ budgets, rows: [{ spent: 9_000_000 }] })
    await expect(mod.assertBudget(1, 'embedding', 'plan', { planId: 'pro', ownChatProvider: true })).rejects.toMatchObject({ kind: 'embedding' })
  })

  it('the exhausted warning uses the budget of the plan that spent it', async () => {
    // $1.00 of spend after a $0.50 call: that is the whole Standard budget ($1)
    // but a fifth of the Pro one ($5).
    const standard = await loadBudget({ budgets, rows: [{ spent: 1_000_000 }] })
    await standard.mod.recordSpend(1, 'chat', 'plan', 500_000, new Date(), 'standard')
    expect(standard.warn).toHaveBeenCalledWith('platform AI budget exhausted', expect.objectContaining({ tier: 'plan' }))

    const pro = await loadBudget({ budgets, rows: [{ spent: 1_000_000 }] })
    await pro.mod.recordSpend(1, 'chat', 'plan', 500_000, new Date(), 'pro')
    expect(pro.warn).not.toHaveBeenCalled()
  })

  it('the 80% warning fires when a call crosses 80% of that plan budget', async () => {
    const { mod, warn } = await loadBudget({ budgets, rows: [{ spent: 4_000_000 }] })
    await mod.recordSpend(1, 'chat', 'plan', 500_000, new Date(), 'pro')
    expect(warn).toHaveBeenCalledWith('platform AI budget crossed 80%', expect.objectContaining({ tier: 'plan' }))
  })

  describe('getBillingScope', () => {
    it('returns the tier and the plan for a paid subscription', async () => {
      const { mod } = await loadBudget({})
      expect(await mod.getBillingScope(1)).toEqual({ tier: 'plan', planId: 'pro' })
    })

    it('has no plan during the trial', async () => {
      const { mod } = await loadBudget({ subscription: { status: 'trialing', planId: 'enterprise' } })
      expect(await mod.getBillingScope(1)).toEqual({ tier: 'trial', planId: null })
    })

    it('has no plan when the stored plan is not one we sell', async () => {
      const { mod } = await loadBudget({ subscription: { status: 'active', planId: 'retired' } })
      expect(await mod.getBillingScope(1)).toEqual({ tier: 'plan', planId: null })
    })

    it('has no plan when the subscription row carries none', async () => {
      const { mod } = await loadBudget({ subscription: { status: 'active' } })
      expect(await mod.getBillingScope(1)).toEqual({ tier: 'plan', planId: null })
    })

    it('is null without a live subscription', async () => {
      const { mod } = await loadBudget({ subscription: null })
      expect(await mod.getBillingScope(1)).toBeNull()
      const canceled = await loadBudget({ subscription: { status: 'canceled', planId: 'pro' } })
      expect(await canceled.mod.getBillingScope(1)).toBeNull()
    })

    it('getBillingTier still answers with just the tier', async () => {
      const { mod } = await loadBudget({})
      expect(await mod.getBillingTier(1)).toBe('plan')
    })
  })

  it('getBudgetStatus judges answers against the budget of the workspace plan', async () => {
    const standard = await loadBudget({ budgets, rows: [{ chat: 1_500_000, embedding: 0 }], subscription: { status: 'active', planId: 'standard' } })
    expect((await standard.mod.getBudgetStatus(1))?.chat).toMatchObject({ included: true, exhausted: true })

    const pro = await loadBudget({ budgets, rows: [{ chat: 1_500_000, embedding: 0 }], subscription: { status: 'active', planId: 'pro' } })
    expect((await pro.mod.getBudgetStatus(1))?.chat).toMatchObject({ included: true, exhausted: false, warning: false })
  })
})
