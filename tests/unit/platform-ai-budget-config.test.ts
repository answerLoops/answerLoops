import { describe, it, expect, vi, beforeEach } from 'vitest'

// Included AI usage limits are operational settings that live only in the
// hosting platform's environment. There are no defaults in code: an unset or
// unusable variable means the platform covers nothing for that budget. These
// values are arbitrary and chosen only for arithmetic.

describe('parseBudgetUsd', () => {
  it.each([
    ['2.5', 2_500_000],
    ['0.000001', 1],
    ['1e3', 1_000_000_000],
    ['  3 ', 3_000_000],
  ])('%j parses to %d micros', async (raw, micros) => {
    const { parseBudgetUsd } = await import('@/lib/billing/platform-ai-budget-config')
    expect(parseBudgetUsd(raw)).toBe(micros)
  })

  it.each([undefined, '', '   ', 'abc', '-1', 'NaN', 'Infinity'])('%j is unusable', async (raw) => {
    const { parseBudgetUsd } = await import('@/lib/billing/platform-ai-budget-config')
    expect(parseBudgetUsd(raw)).toBeNull()
  })

  it('"0" is a valid zero budget, not unusable', async () => {
    const { parseBudgetUsd } = await import('@/lib/billing/platform-ai-budget-config')
    expect(parseBudgetUsd('0')).toBe(0)
  })
})

describe('readBudgets', () => {
  it('maps each env var to its tier and kind; unusable values become 0', async () => {
    const { readBudgets, BUDGET_ENV_VARS } = await import('@/lib/billing/platform-ai-budget-config')
    const env = {
      [BUDGET_ENV_VARS.trial.chat]: '1',
      [BUDGET_ENV_VARS.trial.embedding]: '2',
      [BUDGET_ENV_VARS.plan.chat]: 'oops',
    }
    expect(readBudgets(env)).toEqual({
      trial: { chat: 1_000_000, embedding: 2_000_000 },
      plan: { chat: 0, embedding: 0 },
    })
  })

  it('uses the agreed variable names', async () => {
    const { BUDGET_ENV_VARS } = await import('@/lib/billing/platform-ai-budget-config')
    expect(BUDGET_ENV_VARS).toEqual({
      trial: { chat: 'PLATFORM_AI_TRIAL_CHAT_BUDGET_USD', embedding: 'PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD' },
      plan: { chat: 'PLATFORM_AI_PLAN_CHAT_BUDGET_USD', embedding: 'PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD' },
    })
  })
})

describe('getBudgetMicros', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    for (const name of [
      'PLATFORM_AI_TRIAL_CHAT_BUDGET_USD', 'PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD',
      'PLATFORM_AI_PLAN_CHAT_BUDGET_USD', 'PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD',
    ]) vi.stubEnv(name, '')
  })

  it('logs each unusable variable once on hosted, then serves the cached value', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('PLATFORM_AI_TRIAL_CHAT_BUDGET_USD', '4')
    const error = vi.fn()
    vi.doMock('@/lib/logger', () => ({ logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    const { getBudgetMicros } = await import('@/lib/billing/platform-ai-budget-config')
    expect(getBudgetMicros('trial', 'chat')).toBe(4_000_000)
    expect(getBudgetMicros('plan', 'chat')).toBe(0)
    getBudgetMicros('plan', 'chat')
    expect(error).toHaveBeenCalledTimes(3)
  })

  it('does not log on self-hosted', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', '')
    const error = vi.fn()
    vi.doMock('@/lib/logger', () => ({ logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    const { getBudgetMicros } = await import('@/lib/billing/platform-ai-budget-config')
    getBudgetMicros('plan', 'embedding')
    expect(error).not.toHaveBeenCalled()
  })
})
