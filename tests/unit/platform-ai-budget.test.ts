import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pg-proxy'

// Included platform AI usage per workspace: trial spend covers the whole
// trial, paid-plan spend resets each UTC month. Budgets come from the
// environment; values here are arbitrary and only for arithmetic. Verified
// against drizzle's pg-proxy driver (compiled SQL, no real connection), the
// same way tests/unit/org-ticket-numbers.test.ts checks its atomic update.

const SRC = () => fs.readFileSync(path.join(process.cwd(), 'lib/billing/platform-ai-budget.ts'), 'utf-8')

const BUDGET_VARS = [
  'PLATFORM_AI_TRIAL_CHAT_BUDGET_USD', 'PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD',
  'PLATFORM_AI_PLAN_CHAT_BUDGET_USD', 'PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD',
]

async function load(opts: {
  status?: string | null
  rows?: Record<string, unknown>[]
  budgets?: Record<string, string>
  cfg?: Record<string, unknown> | null
  deployment?: string
}) {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv('DEPLOYMENT_MODE', opts.deployment ?? 'cloud')
  for (const name of [...BUDGET_VARS, 'PLATFORM_AI_CHAT_MODEL', 'PLATFORM_AI_FAST_MODEL', 'PLATFORM_AI_EMBEDDING_MODEL']) vi.stubEnv(name, '')
  for (const [k, v] of Object.entries(opts.budgets ?? {})) vi.stubEnv(k, v)
  const captured: { sql: string; params: unknown[] }[] = []
  const fakeDb = drizzle(async (sql, params) => {
    captured.push({ sql, params })
    return { rows: opts.rows ?? [] }
  })
  const warn = vi.fn()
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
  vi.doMock('@/lib/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
  vi.doMock('@/lib/db/queries/billing', () => ({
    getSubscription: async () => (opts.status === null ? null : { status: opts.status ?? 'active' }),
  }))
  vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => opts.cfg ?? null }))
  const mod = await import('@/lib/billing/platform-ai-budget')
  return { mod, captured, warn }
}

beforeEach(() => vi.resetModules())

describe('tierForStatus', () => {
  it.each([
    ['trialing', 'trial'], ['active', 'plan'], ['past_due', 'plan'],
    ['canceled', null], ['incomplete', null], [null, null], [undefined, null],
  ])('%s → %s', async (status, tier) => {
    const { mod } = await load({})
    expect(mod.tierForStatus(status as string | null)).toBe(tier)
  })
})

describe('currentPeriod', () => {
  it('uses the UTC year-month', async () => {
    const { mod } = await load({})
    expect(mod.currentPeriod(new Date('2026-03-31T23:30:00-05:00'))).toBe('2026-04')
    expect(mod.currentPeriod(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12')
  })
})

describe('assertBudget', () => {
  const env = { PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '1', PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD: '1' }

  it('passes under budget', async () => {
    const { mod } = await load({ budgets: env, rows: [{ spent: 999_999 }] })
    await expect(mod.assertBudget(1, 'chat', 'plan')).resolves.toBeUndefined()
  })

  it('throws the matching kind and tier at budget', async () => {
    const { mod } = await load({ budgets: env, rows: [{ spent: 1_000_000 }] })
    await expect(mod.assertBudget(1, 'chat', 'plan')).rejects.toMatchObject({ name: 'PlatformBudgetExhaustedError', kind: 'chat', tier: 'plan' })
  })

  it('reads bigint spend returned as a string', async () => {
    const { mod } = await load({ budgets: env, rows: [{ spent: '1000000' }] })
    await expect(mod.assertBudget(1, 'chat', 'plan')).rejects.toMatchObject({ kind: 'chat' })
  })

  it('treats a zero (unset) budget as exhausted without reading spend', async () => {
    const { mod, captured } = await load({ budgets: env })
    await expect(mod.assertBudget(1, 'embedding', 'plan')).rejects.toMatchObject({ kind: 'embedding', tier: 'plan' })
    expect(captured).toHaveLength(0)
  })

  it("reads plan spend from this month's row and trial spend from orgs", async () => {
    const plan = await load({ budgets: env, rows: [{ spent: 0 }] })
    await plan.mod.assertBudget(1, 'chat', 'plan')
    expect(plan.captured[0].sql).toMatch(/from platform_ai_usage/i)
    expect(plan.captured[0].params).toContain(plan.mod.currentPeriod())

    const trial = await load({ budgets: env, rows: [{ spent: 0 }] })
    await trial.mod.assertBudget(1, 'embedding', 'trial')
    expect(trial.captured[0].sql).toMatch(/trial_embedding_spend_micros/i)
    expect(trial.captured[0].sql).toMatch(/from orgs/i)
  })

  it('a missing usage row counts as zero spend', async () => {
    const { mod } = await load({ budgets: env, rows: [] })
    await expect(mod.assertBudget(1, 'chat', 'plan')).resolves.toBeUndefined()
  })
})

describe('recordSpend', () => {
  it('trial spend is one atomic UPDATE on orgs with RETURNING', async () => {
    const { mod, captured } = await load({ budgets: { PLATFORM_AI_TRIAL_CHAT_BUDGET_USD: '1' }, rows: [{ spent: 5 }] })
    await mod.recordSpend(1, 'chat', 'trial', 5)
    expect(captured).toHaveLength(1)
    expect(captured[0].sql).toMatch(/update orgs set trial_chat_spend_micros = trial_chat_spend_micros \+ \$1 where id = \$2 returning/i)
  })

  it('plan spend is one upsert that adds to the month row, never overwrites', async () => {
    const { mod, captured } = await load({ budgets: { PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '1' }, rows: [{ spent: 5 }] })
    await mod.recordSpend(1, 'chat', 'plan', 5)
    expect(captured).toHaveLength(1)
    expect(captured[0].sql).toMatch(/insert into platform_ai_usage/i)
    expect(captured[0].sql).toMatch(/on conflict \(org_id, period\) do update set chat_spend_micros = platform_ai_usage\.chat_spend_micros \+ excluded\.chat_spend_micros/i)
    expect(captured[0].params).toContain(mod.currentPeriod())
  })

  it('skips the write for zero micros', async () => {
    const { mod, captured } = await load({ budgets: { PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '1' } })
    await mod.recordSpend(1, 'chat', 'plan', 0)
    expect(captured).toHaveLength(0)
  })

  it('warns when a call crosses the 80% line', async () => {
    // 750k before this call, 850k after: crosses the 800k line.
    const t = await load({ budgets: { PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '1' }, rows: [{ spent: 850_000 }] })
    await t.mod.recordSpend(1, 'chat', 'plan', 100_000)
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining('80%'), expect.objectContaining({ orgId: 1, kind: 'chat', tier: 'plan' }))
  })

  it('warns when a call crosses the budget', async () => {
    const t = await load({ budgets: { PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '1' }, rows: [{ spent: 1_000_000 }] })
    await t.mod.recordSpend(1, 'chat', 'plan', 1)
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining('exhausted'), expect.objectContaining({ orgId: 1 }))
  })

  it('stays quiet when no line is crossed', async () => {
    const t = await load({ budgets: { PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '1' }, rows: [{ spent: 500_000 }] })
    await t.mod.recordSpend(1, 'chat', 'plan', 1)
    expect(t.warn).not.toHaveBeenCalled()
  })
})

describe('getBudgetStatus', () => {
  const env = {
    PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '1', PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD: '1',
    PLATFORM_AI_TRIAL_CHAT_BUDGET_USD: '1', PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD: '1',
  }

  const OWN_OPENAI = { chat_provider: 'openai', chat_api_key: 'test-key', embedding_api_key: null, embedding_base_url: null }
  const OWN_ANTHROPIC = { chat_provider: 'anthropic', chat_api_key: 'test-key', embedding_api_key: null, embedding_base_url: null }

  it('null on self-hosted, when both kinds run on the workspace key, or with no live subscription', async () => {
    expect(await (await load({ budgets: env, deployment: '' })).mod.getBudgetStatus(1)).toBeNull()
    expect(await (await load({ budgets: env, cfg: OWN_OPENAI })).mod.getBudgetStatus(1)).toBeNull()
    expect(await (await load({ budgets: env, status: 'canceled' })).mod.getBudgetStatus(1)).toBeNull()
  })

  it('warning is true at exactly 80%, and the result carries only flags, never amounts or fractions', async () => {
    const { mod } = await load({ budgets: env, status: 'active', rows: [{ chat: 800_000, embedding: 0 }] })
    const s = await mod.getBudgetStatus(1)
    expect(s).toEqual({
      tier: 'plan',
      ownChatProvider: false,
      chat: { included: true, warning: true, exhausted: false },
      embedding: { included: true, warning: false, exhausted: false },
      models: { chat: 'gpt-5.6-terra', fast: 'gpt-5.6-luna', embedding: 'text-embedding-3-small' },
    })
  })

  it('a zero budget reports exhausted', async () => {
    const { mod } = await load({ budgets: { PLATFORM_AI_PLAN_CHAT_BUDGET_USD: '1' }, status: 'active', rows: [{ chat: 0, embedding: 0 }] })
    expect((await mod.getBudgetStatus(1))?.embedding).toEqual({ included: true, warning: true, exhausted: true })
  })

  it('a workspace whose own chat provider cannot embed sees its knowledge-base usage, and only that', async () => {
    const { mod } = await load({ budgets: env, cfg: OWN_ANTHROPIC, status: 'active', rows: [{ chat: 0, embedding: 900_000 }] })
    expect(await mod.getBudgetStatus(1)).toMatchObject({
      ownChatProvider: true,
      chat: { included: false, warning: false, exhausted: false },
      embedding: { included: true, warning: true, exhausted: false },
    })
  })

  it('a trial converting to active reads the plan tier on the next call', async () => {
    const trial = await load({ budgets: env, status: 'trialing', rows: [{ chat: 0, embedding: 0 }] })
    expect((await trial.mod.getBudgetStatus(1))?.tier).toBe('trial')
    expect(trial.captured.at(-1)?.sql).toMatch(/from orgs/i)
    const active = await load({ budgets: env, status: 'active', rows: [{ chat: 0, embedding: 0 }] })
    expect((await active.mod.getBudgetStatus(1))?.tier).toBe('plan')
    expect(active.captured.at(-1)?.sql).toMatch(/from platform_ai_usage/i)
  })
})

describe('source', () => {
  it('never exposes budget amounts from the status helper', () => {
    const body = SRC().slice(SRC().indexOf('export async function getBudgetStatus'))
    expect(body).not.toMatch(/budgetMicros:|spentMicros:|fraction:/)
  })
})
