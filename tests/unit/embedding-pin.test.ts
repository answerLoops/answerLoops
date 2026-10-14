import { describe, it, expect, vi, beforeEach } from 'vitest'

// A workspace's stored vectors are only comparable with query vectors from
// the same embedding model. Each workspace is pinned to the model its vectors
// belong to, and keeps using it until the re-embed job moves them, even when
// the platform (or the workspace) switches models.

async function load(o: {
  deployment?: string
  cfg?: Record<string, unknown> | null
  pin?: string | null
  tier?: 'trial' | 'plan' | null
  env?: Record<string, string>
  budgetError?: boolean
}) {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv('DEPLOYMENT_MODE', o.deployment ?? 'cloud')
  for (const name of ['PLATFORM_AI_CHAT_MODEL', 'PLATFORM_AI_FAST_MODEL', 'PLATFORM_AI_EMBEDDING_MODEL']) vi.stubEnv(name, '')
  for (const [k, v] of Object.entries(o.env ?? {})) vi.stubEnv(k, v)
  const ensurePin = vi.fn(async (_orgId: number, m: string) => m)
  const meterEmbeddingModel = vi.fn((m: { modelId: string }, t: { modelId: string }) => ({ metered: true, modelId: m.modelId, target: t }))
  const warn = vi.fn()
  const getBillingTier = vi.fn(async () => (o.tier === undefined ? 'plan' : o.tier))
  const assertBudget = vi.fn(async (orgId: number, kind: 'chat' | 'embedding', tier: 'trial' | 'plan') => {
    if (o.budgetError) {
      const { PlatformBudgetExhaustedError } = await import('@/lib/ai/errors')
      throw new PlatformBudgetExhaustedError(orgId, kind, tier)
    }
  })
  vi.doMock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))
  vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => o.cfg ?? null, orgHasAIKey: async () => false }))
  vi.doMock('@/lib/billing/platform-ai-budget', () => ({ getBillingTier, assertBudget }))
  vi.doMock('@/lib/ai/metering', () => ({ meterLanguageModel: vi.fn(), meterEmbeddingModel }))
  const platformEmbedding = vi.fn((id: string) => ({ modelId: id, platform: true }))
  vi.doMock('@/lib/ai/platform-models', async (orig) => ({
    ...(await orig<typeof import('@/lib/ai/platform-models')>()),
    platformEmbedding,
  }))
  vi.doMock('@/lib/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
  vi.doMock('@/lib/ai/embedding-pin', async (orig) => ({
    ...(await orig<typeof import('@/lib/ai/embedding-pin')>()),
    getPinnedModel: async () => o.pin ?? null,
    ensurePin,
  }))
  return { models: await import('@/lib/ai/models'), ensurePin, meterEmbeddingModel, warn, getBillingTier, assertBudget, platformEmbedding }
}

const OWN_ADA = {
  chat_provider: 'openai', chat_model: 'x', chat_api_key: 'test-key', chat_base_url: null,
  embedding_provider: 'openai', embedding_model: 'text-embedding-ada-002', embedding_api_key: null, embedding_base_url: null,
}

beforeEach(() => vi.resetModules())

describe('embeddingTargetFor', () => {
  it('own config targets its saved model; otherwise the platform model; unusable platform model gives none', async () => {
    const { embeddingTargetFor } = await import('@/lib/ai/embedding-pin')
    expect(embeddingTargetFor(OWN_ADA as never, 'text-embedding-3-small')).toEqual({ modelId: 'text-embedding-ada-002', own: true })
    expect(embeddingTargetFor(null, 'text-embedding-3-large')).toEqual({ modelId: 'text-embedding-3-large', own: false })
    expect(embeddingTargetFor(null, null)).toBeNull()
  })

  it('a non-OpenAI chat key alone is not an embedding config', async () => {
    const { hasOwnEmbeddingConfig } = await import('@/lib/ai/embedding-pin')
    expect(hasOwnEmbeddingConfig({ ...OWN_ADA, chat_provider: 'anthropic' } as never)).toBe(false)
    expect(hasOwnEmbeddingConfig({ ...OWN_ADA, chat_provider: 'anthropic', embedding_api_key: 'test-key' } as never)).toBe(true)
  })
})

describe('resolveEmbedding', () => {
  it('first write pins the workspace to its target', async () => {
    const t = await load({ pin: null })
    expect((await t.models.resolveEmbedding('text-embedding-3-small', 1)).modelId).toBe('text-embedding-3-small')
    expect(t.ensurePin).toHaveBeenCalledWith(1, 'text-embedding-3-small')
    expect(t.meterEmbeddingModel).toHaveBeenCalled()
  })

  it('platform model changed in the environment: keeps the pinned model until re-embedded, metered and budget-checked', async () => {
    const t = await load({ pin: 'text-embedding-3-small', env: { PLATFORM_AI_EMBEDDING_MODEL: 'text-embedding-3-large' } })
    expect((await t.models.resolveEmbedding('text-embedding-3-small', 1)).modelId).toBe('text-embedding-3-small')
    expect(t.assertBudget).toHaveBeenCalledWith(1, 'embedding', 'plan', expect.anything())
    expect(t.meterEmbeddingModel).toHaveBeenCalledWith(expect.anything(), { orgId: 1, tier: 'plan', modelId: 'text-embedding-3-small' })
  })

  it('pending re-embed on the platform with the budget used up: refused, never served free', async () => {
    const t = await load({ pin: 'text-embedding-3-small', budgetError: true, env: { PLATFORM_AI_EMBEDDING_MODEL: 'text-embedding-3-large' } })
    await expect(t.models.resolveEmbedding('text-embedding-3-small', 1)).rejects.toMatchObject({ name: 'PlatformBudgetExhaustedError' })
  })

  it('pending re-embed toward an own config: the workspace key serves the pinned model, never the platform', async () => {
    const t = await load({ pin: 'text-embedding-3-small', cfg: OWN_ADA, tier: null })
    expect((await t.models.resolveEmbedding('text-embedding-3-small', 1)).modelId).toBe('text-embedding-3-small')
    expect(t.meterEmbeddingModel).not.toHaveBeenCalled()
    expect(t.getBillingTier).not.toHaveBeenCalled()
    expect(t.assertBudget).not.toHaveBeenCalled()
    expect(t.platformEmbedding).not.toHaveBeenCalled()
  })

  it('pending re-embed toward an own config with an unpriced pinned model: still the workspace key', async () => {
    const t = await load({ pin: 'nomic-embed-text', cfg: OWN_ADA, tier: null })
    expect((await t.models.resolveEmbedding('text-embedding-3-small', 1)).modelId).toBe('nomic-embed-text')
    expect(t.meterEmbeddingModel).not.toHaveBeenCalled()
    expect(t.platformEmbedding).not.toHaveBeenCalled()
  })

  it('pin matches target: normal metered path', async () => {
    const t = await load({ pin: 'text-embedding-3-large', env: { PLATFORM_AI_EMBEDDING_MODEL: 'text-embedding-3-large' } })
    expect((await t.models.resolveEmbedding('text-embedding-3-small', 1)).modelId).toBe('text-embedding-3-large')
    expect(t.meterEmbeddingModel).toHaveBeenCalled()
  })

  it('pending re-embed with no live subscription and no own key: refused', async () => {
    const t = await load({ pin: 'text-embedding-3-small', tier: null, env: { PLATFORM_AI_EMBEDDING_MODEL: 'text-embedding-3-large' } })
    await expect(t.models.resolveEmbedding('text-embedding-3-small', 1)).rejects.toMatchObject({ name: 'NoAIProviderConfiguredError' })
  })

  it('a pinned model the platform cannot serve: the target model, metered, with a warning', async () => {
    const t = await load({ pin: 'nomic-embed-text' })
    expect((await t.models.resolveEmbedding('text-embedding-3-small', 1)).modelId).toBe('text-embedding-3-small')
    expect(t.meterEmbeddingModel).toHaveBeenCalled()
    expect(t.warn).toHaveBeenCalled()
  })

  it('own config whose pin matches: own provider, unmetered', async () => {
    const t = await load({ pin: 'text-embedding-ada-002', cfg: OWN_ADA })
    expect((await t.models.resolveEmbedding('text-embedding-3-small', 1)).modelId).toBe('text-embedding-ada-002')
    expect(t.meterEmbeddingModel).not.toHaveBeenCalled()
  })

  it('self-hosted keeps its pin too', async () => {
    const t = await load({ deployment: '', pin: 'text-embedding-ada-002', tier: null })
    expect((await t.models.resolveEmbedding('text-embedding-3-small', 1)).modelId).toBe('text-embedding-ada-002')
    expect(t.meterEmbeddingModel).not.toHaveBeenCalled()
  })
})
