import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'

// Who pays for a model call. On hosted, a workspace with its own provider
// uses it; without one it runs on the platform's models (from the
// environment, never a model it saved) within its included usage, metered;
// with no live subscription, or the budget used up, it gets no AI.
// Self-hosted keeps using its own .env key unmetered.

async function load(o: {
  deployment?: string
  cfg?: Record<string, unknown> | null
  tier?: 'trial' | 'plan' | null
  budgetError?: boolean
  env?: Record<string, string>
}) {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv('DEPLOYMENT_MODE', o.deployment ?? 'cloud')
  for (const name of ['PLATFORM_AI_CHAT_MODEL', 'PLATFORM_AI_FAST_MODEL', 'PLATFORM_AI_EMBEDDING_MODEL']) vi.stubEnv(name, '')
  for (const [k, v] of Object.entries(o.env ?? {})) vi.stubEnv(k, v)
  const assertBudget = vi.fn(async (orgId: number, kind: 'chat' | 'embedding', tier: 'trial' | 'plan') => {
    if (o.budgetError) {
      const { PlatformBudgetExhaustedError } = await import('@/lib/ai/errors')
      throw new PlatformBudgetExhaustedError(orgId, kind, tier)
    }
  })
  const meterLanguageModel = vi.fn((m: { modelId: string }) => ({ metered: true, modelId: m.modelId }))
  const meterEmbeddingModel = vi.fn((m: { modelId: string }) => ({ metered: true, modelId: m.modelId }))
  vi.doMock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))
  vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => o.cfg ?? null, orgHasAIKey: async () => false }))
  vi.doMock('@/lib/billing/platform-ai-budget', () => ({ getBillingTier: async () => o.tier ?? null, assertBudget }))
  vi.doMock('@/lib/ai/metering', () => ({ meterLanguageModel, meterEmbeddingModel }))
  vi.doMock('@/lib/ai/embedding-pin', async (orig) => ({
    ...(await orig<typeof import('@/lib/ai/embedding-pin')>()),
    // Pin always matches the target here; pinning has its own tests.
    getPinnedModel: async () => null,
    ensurePin: async (_orgId: number, modelId: string) => modelId,
  }))
  vi.doMock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
  return { models: await import('@/lib/ai/models'), assertBudget, meterLanguageModel, meterEmbeddingModel }
}

const OWN = { chat_provider: 'openai', chat_model: 'gpt-x', chat_api_key: 'test-key', chat_base_url: null, embedding_provider: 'openai', embedding_model: 'text-embedding-3-small', embedding_api_key: null, embedding_base_url: null }
const NO_KEY_SAVED = { ...OWN, chat_api_key: null, chat_model: 'gpt-5.6-terra', embedding_model: 'text-embedding-ada-002' }
const id = (m: unknown) => (m as { modelId: string }).modelId

beforeEach(() => vi.resetModules())

describe('chatModel', () => {
  it.each(['trial', 'plan'] as const)('hosted, no key, %s: platform model for the role, metered', async (tier) => {
    const t = await load({ tier, env: { PLATFORM_AI_FAST_MODEL: 'gpt-5.6-terra' } })
    expect(id(await t.models.chatModel(t.models.DEFAULT_FAST_MODEL, 1))).toBe('gpt-5.6-terra')
    expect(t.assertBudget).toHaveBeenCalledWith(1, 'chat', tier)
    expect(t.meterLanguageModel).toHaveBeenCalledWith(expect.anything(), { orgId: 1, tier, modelId: 'gpt-5.6-terra' })
  })

  it('a model simulation asked for is ignored for the platform chat model', async () => {
    const t = await load({ tier: 'plan' })
    expect(id(await t.models.chatModel('gpt-4o-mini', 1))).toBe(t.models.DEFAULT_CHAT_MODEL)
  })

  it('models a workspace saved are ignored without its own key', async () => {
    const t = await load({ tier: 'plan', cfg: NO_KEY_SAVED, env: { PLATFORM_AI_CHAT_MODEL: 'gpt-5.6-luna' } })
    expect(id(await t.models.chatModel(t.models.DEFAULT_CHAT_MODEL, 1))).toBe('gpt-5.6-luna')
  })

  it('an unusable platform model is refused, not metered', async () => {
    const t = await load({ tier: 'plan', env: { PLATFORM_AI_CHAT_MODEL: 'gpt-unknown' } })
    await expect(t.models.chatModel(t.models.DEFAULT_CHAT_MODEL, 1)).rejects.toMatchObject({ name: 'NoAIProviderConfiguredError' })
    expect(t.meterLanguageModel).not.toHaveBeenCalled()
  })

  it('no live subscription: refused before any budget check', async () => {
    const t = await load({ tier: null })
    await expect(t.models.chatModel(t.models.DEFAULT_CHAT_MODEL, 1)).rejects.toMatchObject({ name: 'NoAIProviderConfiguredError' })
    expect(t.assertBudget).not.toHaveBeenCalled()
  })

  it('a used-up budget propagates', async () => {
    const t = await load({ tier: 'plan', budgetError: true })
    await expect(t.models.chatModel(t.models.DEFAULT_CHAT_MODEL, 1)).rejects.toMatchObject({ name: 'PlatformBudgetExhaustedError' })
  })

  it('own key: unmetered, no budget check', async () => {
    const t = await load({ tier: 'plan', cfg: OWN })
    await t.models.chatModel(t.models.DEFAULT_CHAT_MODEL, 1)
    expect(t.meterLanguageModel).not.toHaveBeenCalled()
    expect(t.assertBudget).not.toHaveBeenCalled()
  })

  it('self-hosted: the requested model, unmetered', async () => {
    const t = await load({ deployment: '', tier: null })
    expect(id(await t.models.chatModel('gpt-4o-mini', 1))).toBe('gpt-4o-mini')
    expect(t.meterLanguageModel).not.toHaveBeenCalled()
  })

  it('no orgId: unmetered', async () => {
    const t = await load({ tier: null })
    await t.models.chatModel(t.models.DEFAULT_CHAT_MODEL)
    expect(t.meterLanguageModel).not.toHaveBeenCalled()
  })
})

describe('embeddingModel', () => {
  it('hosted, no key: platform embedding model, metered', async () => {
    const t = await load({ tier: 'trial' })
    await t.models.embeddingModel(t.models.DEFAULT_EMBEDDING_MODEL, 1)
    expect(t.assertBudget).toHaveBeenCalledWith(1, 'embedding', 'trial')
    expect(t.meterEmbeddingModel).toHaveBeenCalledWith(expect.anything(), { orgId: 1, tier: 'trial', modelId: 'text-embedding-3-small' })
  })

  it('hosted, no key, saved embedding model: still the platform model', async () => {
    const t = await load({ tier: 'plan', cfg: NO_KEY_SAVED, env: { PLATFORM_AI_EMBEDDING_MODEL: 'text-embedding-3-large' } })
    await t.models.embeddingModel(t.models.DEFAULT_EMBEDDING_MODEL, 1)
    expect(t.meterEmbeddingModel).toHaveBeenCalledWith(expect.anything(), { orgId: 1, tier: 'plan', modelId: 'text-embedding-3-large' })
  })

  it('own OpenAI key: unmetered', async () => {
    const t = await load({ tier: 'plan', cfg: OWN })
    await t.models.embeddingModel(t.models.DEFAULT_EMBEDDING_MODEL, 1)
    expect(t.meterEmbeddingModel).not.toHaveBeenCalled()
  })

  it('no live subscription: refused', async () => {
    const t = await load({ tier: null })
    await expect(t.models.embeddingModel(t.models.DEFAULT_EMBEDDING_MODEL, 1)).rejects.toMatchObject({ name: 'NoAIProviderConfiguredError' })
  })
})

describe('the purpose parameter is gone', () => {
  it.each([
    'lib/ai/models.ts', 'lib/ai/embed.ts', 'lib/ai/triage.ts', 'lib/ai/assess.ts', 'lib/ai/agent.ts',
    'lib/ingest/pipeline.ts', 'app/api/ingest/retry-stuck/route.ts', 'app/api/simulation/run/route.ts',
  ])('%s', (f) => {
    expect(fs.readFileSync(f, 'utf-8')).not.toMatch(/ModelPurpose|'sandbox'|'trial'|aiPurpose|reservePlatformKeyTrial/)
  })
})
