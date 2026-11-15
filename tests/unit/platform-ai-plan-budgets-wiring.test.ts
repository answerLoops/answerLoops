import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { generateText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

// The per-plan budget only protects anything if every hop passes the plan
// along: the subscription lookup, the budget check, the metering target and the
// spend record. The unit tests for each hop mock its neighbours, so a hop that
// quietly drops the plan (and so reads the shared paid-plan budget) would pass
// them all. These tests cover the seams: one wires metering to the real spend
// recorder, one drives the embedding path for a paid plan, and the source
// guards pin who may call the budget functions at all. Budget numbers are
// arbitrary.

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue
      walk(rel, out)
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel)
  }
  return out
}

// doMock registrations outlive resetModules, so each test starts from none.
beforeEach(() => {
  for (const m of ['@/lib/billing/platform-ai-budget', '@/lib/ai/metering', '@/lib/ai/embedding-pin', '@/lib/db/drizzle', '@/lib/db/queries/billing', '@/lib/db/queries/ai-config', '@/lib/mock-mode', '@/lib/logger']) vi.doUnmock(m)
})

const ALL_VARS = [
  'PLATFORM_AI_TRIAL_CHAT_BUDGET_USD', 'PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD',
  'PLATFORM_AI_PLAN_CHAT_BUDGET_USD', 'PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD',
  'PLATFORM_AI_STANDARD_CHAT_BUDGET_USD', 'PLATFORM_AI_PRO_CHAT_BUDGET_USD', 'PLATFORM_AI_ENTERPRISE_CHAT_BUDGET_USD',
]

describe('metering records spend against the plan it was given (real recorder)', () => {
  async function loadChain(budgets: Record<string, string>, spentAfter: number) {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    for (const name of ALL_VARS) vi.stubEnv(name, '1')
    for (const [k, v] of Object.entries(budgets)) vi.stubEnv(k, v)
    const warn = vi.fn()
    const fakeDb = drizzle(async () => ({ rows: [{ spent: spentAfter }] }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    vi.doMock('@/lib/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    vi.doMock('@/lib/db/queries/billing', () => ({ getSubscription: async () => null }))
    vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => null }))
    const metering = await import('@/lib/ai/metering')
    const pricing = await import('@/lib/ai/pricing')
    return { metering, pricing, warn }
  }

  const usage = {
    inputTokens: { total: 100_000, noCache: 100_000, cacheRead: 0, cacheWrite: undefined },
    outputTokens: { total: 1_000, text: 1_000, reasoning: undefined },
  }

  async function runCall(planId: 'standard' | 'pro' | null, budgetsFor: (cost: number) => Record<string, string>) {
    // Price first with a throwaway load so the budgets can be set relative to
    // one call's real cost, whatever the price table says.
    const probe = await loadChain({}, 0)
    const cost = probe.pricing.costMicros('gpt-5.6-luna', { input: 100_000, cachedInput: 0, output: 1_000 })
    expect(cost).toBeGreaterThan(1_000)
    const { metering, warn } = await loadChain(budgetsFor(cost), cost * 2)
    const inner = new MockLanguageModelV3({
      doGenerate: async () => ({ content: [{ type: 'text', text: 'ok' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
    })
    const model = metering.meterLanguageModel(inner, { orgId: 7, tier: 'plan', planId, modelId: 'gpt-5.6-luna' })
    await generateText({ model, prompt: 'q' })
    // The record is fire-and-forget; let it settle.
    await new Promise((r) => setTimeout(r, 25))
    return warn
  }

  // Spend goes from one call's cost to two. A Standard budget of 1.5 calls is
  // crossed by it; a Pro budget of 100 calls is not, and neither is the shared
  // budget that sits between them.
  const usd = (micros: number) => String(micros / 1_000_000)

  it('a Standard call is judged against the Standard budget', async () => {
    const warn = await runCall('standard', (c) => ({
      PLATFORM_AI_STANDARD_CHAT_BUDGET_USD: usd(Math.round(c * 1.5)),
      PLATFORM_AI_PRO_CHAT_BUDGET_USD: usd(c * 100),
      PLATFORM_AI_PLAN_CHAT_BUDGET_USD: usd(c * 100),
    }))
    expect(warn).toHaveBeenCalledWith('platform AI budget exhausted', expect.objectContaining({ orgId: 7, tier: 'plan' }))
  })

  it('a Pro call is judged against the Pro budget, not the smaller shared one', async () => {
    const warn = await runCall('pro', (c) => ({
      PLATFORM_AI_STANDARD_CHAT_BUDGET_USD: usd(Math.round(c * 1.5)),
      PLATFORM_AI_PRO_CHAT_BUDGET_USD: usd(c * 100),
      PLATFORM_AI_PLAN_CHAT_BUDGET_USD: usd(Math.round(c * 1.5)),
    }))
    expect(warn).not.toHaveBeenCalled()
  })

  it('a target without a plan falls to the shared paid-plan budget', async () => {
    const warn = await runCall(null, (c) => ({
      PLATFORM_AI_PRO_CHAT_BUDGET_USD: usd(c * 100),
      PLATFORM_AI_PLAN_CHAT_BUDGET_USD: usd(Math.round(c * 1.5)),
    }))
    expect(warn).toHaveBeenCalledWith('platform AI budget exhausted', expect.objectContaining({ orgId: 7 }))
  })
})

describe('a mid-month upgrade raises the ceiling against the same spend row', () => {
  it('the spend that exhausts Standard leaves a workspace that upgraded to Pro with room, and the status follows', async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    for (const name of ALL_VARS) vi.stubEnv(name, '1')
    vi.stubEnv('PLATFORM_AI_STANDARD_CHAT_BUDGET_USD', '2')
    vi.stubEnv('PLATFORM_AI_PRO_CHAT_BUDGET_USD', '10')
    let planId = 'standard'
    // One usage row for the month, whichever plan asks.
    const fakeDb = drizzle(async () => ({ rows: [{ spent: 2_500_000, chat: 2_500_000, embedding: 0 }] }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    vi.doMock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    vi.doMock('@/lib/db/queries/billing', () => ({ getSubscription: async () => ({ status: 'active', planId }) }))
    vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => null }))
    const mod = await import('@/lib/billing/platform-ai-budget')

    const before = await mod.getBillingScope(1)
    await expect(mod.assertBudget(1, 'chat', before!.tier, { planId: before!.planId })).rejects.toMatchObject({ name: 'PlatformBudgetExhaustedError' })
    expect((await mod.getBudgetStatus(1))?.chat).toMatchObject({ exhausted: true })

    planId = 'pro'
    const after = await mod.getBillingScope(1)
    await expect(mod.assertBudget(1, 'chat', after!.tier, { planId: after!.planId })).resolves.toBeUndefined()
    expect((await mod.getBudgetStatus(1))?.chat).toMatchObject({ exhausted: false, warning: false })
  })
})

describe('embedding on a paid plan keeps the shared embedding budget', () => {
  async function loadEmbedding(planId: 'standard' | 'pro' | 'enterprise' | null, tier: 'trial' | 'plan') {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    for (const name of ['PLATFORM_AI_CHAT_MODEL', 'PLATFORM_AI_FAST_MODEL', 'PLATFORM_AI_EMBEDDING_MODEL']) vi.stubEnv(name, '')
    const assertBudget = vi.fn(async () => {})
    const meterEmbeddingModel = vi.fn((m: { modelId: string }) => ({ metered: true, modelId: m.modelId }))
    vi.doMock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))
    vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => null, orgHasAIKey: async () => false }))
    vi.doMock('@/lib/billing/platform-ai-budget', () => ({ getBillingScope: async () => ({ tier, planId }), assertBudget }))
    vi.doMock('@/lib/ai/metering', () => ({ meterLanguageModel: vi.fn(), meterEmbeddingModel }))
    vi.doMock('@/lib/ai/embedding-pin', async (orig) => ({
      ...(await orig<typeof import('@/lib/ai/embedding-pin')>()),
      getPinnedModel: async () => null,
      ensurePin: async (_orgId: number, modelId: string) => modelId,
    }))
    vi.doMock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    const models = await import('@/lib/ai/models')
    return { models, assertBudget, meterEmbeddingModel }
  }

  it.each(['standard', 'pro', 'enterprise'] as const)('a %s workspace passes its plan with the embedding check and metering', async (planId) => {
    const t = await loadEmbedding(planId, 'plan')
    await t.models.resolveEmbedding(t.models.DEFAULT_EMBEDDING_MODEL, 1)
    expect(t.assertBudget).toHaveBeenCalledWith(1, 'embedding', 'plan', expect.objectContaining({ planId }))
    expect(t.meterEmbeddingModel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tier: 'plan', planId }))
  })

  it('a trial workspace carries no plan on either', async () => {
    const t = await loadEmbedding(null, 'trial')
    await t.models.resolveEmbedding(t.models.DEFAULT_EMBEDDING_MODEL, 1)
    expect(t.assertBudget).toHaveBeenCalledWith(1, 'embedding', 'trial', expect.objectContaining({ planId: null }))
  })
})

describe('the embedding budget and the trial budget ignore the per-plan variables (real recorder and check)', () => {
  it('assertBudget for embedding or trial chat reads the shared amounts even when every plan variable is set', async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    for (const name of ALL_VARS) vi.stubEnv(name, '1')
    vi.stubEnv('PLATFORM_AI_STANDARD_CHAT_BUDGET_USD', '50')
    vi.stubEnv('PLATFORM_AI_PRO_CHAT_BUDGET_USD', '50')
    vi.stubEnv('PLATFORM_AI_ENTERPRISE_CHAT_BUDGET_USD', '50')
    const fakeDb = drizzle(async () => ({ rows: [{ spent: 3_000_000 }] }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
    vi.doMock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    vi.doMock('@/lib/db/queries/billing', () => ({ getSubscription: async () => null }))
    vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => null }))
    const mod = await import('@/lib/billing/platform-ai-budget')
    // Shared embedding and trial chat budgets are $1; $3 is spent.
    await expect(mod.assertBudget(1, 'embedding', 'plan', { planId: 'enterprise' })).rejects.toMatchObject({ kind: 'embedding' })
    await expect(mod.assertBudget(1, 'chat', 'trial', { planId: 'enterprise' })).rejects.toMatchObject({ kind: 'chat', tier: 'trial' })
  })
})

describe('source guards: who calls the budget functions, and with the plan', () => {
  const LIB_APP = ['lib', 'app', 'bot', 'components'].flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? walk(d) : []))
  const callersOf = (name: string) =>
    LIB_APP.filter((f) => !f.startsWith(path.join('lib', 'billing', 'platform-ai-budget'))).filter((f) =>
      new RegExp(`\\b${name}\\s*\\(`).test(read(f)),
    )

  it('only models.ts checks the budget, and it passes the plan', () => {
    expect(callersOf('assertBudget')).toEqual([path.join('lib', 'ai', 'models.ts')])
    expect(read('lib/ai/models.ts')).toMatch(/assertBudget\(orgId, kind, tier, \{ \.\.\.budgetOptions, planId \}\)/)
  })

  it('only metering.ts records spend, and it passes the plan from its target', () => {
    expect(callersOf('recordSpend')).toEqual([path.join('lib', 'ai', 'metering.ts')])
    expect(read('lib/ai/metering.ts')).toMatch(/recordSpend\(target\.orgId, kind, target\.tier, micros, new Date\(\), target\.planId/)
  })

  it('no module outside the budget code reads a budget amount directly', () => {
    expect(callersOf('getBudgetMicros')).toEqual([])
  })

  it('every metering target is built in models.ts, with the plan alongside the tier', () => {
    const builders = LIB_APP.filter((f) => /import[^;]*\bmeter(Language|Embedding)Model\b[^;]*from '@\/lib\/ai\/metering'/.test(read(f)))
    expect(builders).toEqual([path.join('lib', 'ai', 'models.ts')])
    expect(read('lib/ai/models.ts')).toMatch(/\{ orgId, tier, planId, modelId \}/)
  })

  it('every budget read inside the budget module is given the plan', () => {
    const src = read('lib/billing/platform-ai-budget.ts')
    const reads = [...src.matchAll(/getBudgetMicros\(([^)]*)\)/g)].map((m) => m[1])
    expect(reads.length).toBe(4)
    for (const args of reads) expect(args, `getBudgetMicros(${args})`).toMatch(/planId\s*$/)
  })

  it('the usage status goes through the plan-aware getBudgetStatus', () => {
    expect(callersOf('getBudgetStatus').sort()).toEqual([
      path.join('app', '(dashboard)', 'layout.tsx'),
      path.join('app', 'api', 'ai-config', 'usage-status', 'route.ts'),
    ])
  })

  it('a plan variable exists for every plan and none of the three names is in self-host config', () => {
    const cfg = read('lib/billing/platform-ai-budget-config.ts')
    const names = [...cfg.matchAll(/'(PLATFORM_AI_[A-Z]+_CHAT_BUDGET_USD)'/g)].map((m) => m[1])
    for (const n of ['PLATFORM_AI_STANDARD_CHAT_BUDGET_USD', 'PLATFORM_AI_PRO_CHAT_BUDGET_USD', 'PLATFORM_AI_ENTERPRISE_CHAT_BUDGET_USD']) {
      expect(names).toContain(n)
    }
    const files = fs
      .readdirSync(ROOT)
      .filter((f) => /^docker-compose.*\.ya?ml$/.test(f) || /^\.env(\..*)?\.example$/.test(f) || f === '.env.example' || /^Dockerfile/.test(f))
    expect(files).toContain('docker-compose.yml')
    for (const f of files) expect(read(f), f).not.toMatch(/PLATFORM_AI_/)
  })
})
