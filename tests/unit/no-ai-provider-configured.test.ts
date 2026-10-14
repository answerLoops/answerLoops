import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Roadmap item 11, revised for included platform AI usage: on managed cloud
// an org with no AI provider of its own never silently runs on the
// platform's key. It runs there only with a live subscription and included
// usage left (metered, see platform-ai-routing.test.ts); with no live
// subscription it gets NoAIProviderConfiguredError, on every surface,
// including simulation. Self-hosted deployments always may use the platform
// key (it is the self-hoster's own .env).

const { getOrgAIConfig, getBillingTier } = vi.hoisted(() => ({
  getOrgAIConfig: vi.fn(),
  getBillingTier: vi.fn(),
}))
vi.mock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig }))
vi.mock('@/lib/billing/platform-ai-budget', () => ({ getBillingTier, assertBudget: vi.fn() }))
vi.mock('@/lib/ai/embedding-pin', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/embedding-pin')>()),
  getPinnedModel: async () => null,
  ensurePin: async (_orgId: number, modelId: string) => modelId,
}))

async function models() {
  return import('@/lib/ai/models')
}

beforeEach(() => {
  getOrgAIConfig.mockReset()
  getBillingTier.mockReset().mockResolvedValue(null)
  delete process.env.DEPLOYMENT_MODE
  delete process.env.MOCK_EXTERNALS
})

afterEach(() => {
  delete process.env.DEPLOYMENT_MODE
})

describe('chatModel on managed cloud', () => {
  it('throws NoAIProviderConfiguredError when the org has no key and no live subscription', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    getOrgAIConfig.mockResolvedValue(null)
    const { chatModel, NoAIProviderConfiguredError } = await models()

    await expect(chatModel('gpt-4o', 42)).rejects.toBeInstanceOf(NoAIProviderConfiguredError)
  })

  it('throws even when a config row exists but has no key and is not openai-compatible', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    getOrgAIConfig.mockResolvedValue({ chat_provider: 'openai', chat_api_key: null, chat_model: 'gpt-4o', chat_base_url: null })
    const { chatModel, NoAIProviderConfiguredError } = await models()

    await expect(chatModel('gpt-4o', 42)).rejects.toBeInstanceOf(NoAIProviderConfiguredError)
  })

  it('does not throw when the org has a configured key', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    getOrgAIConfig.mockResolvedValue({ chat_provider: 'anthropic', chat_api_key: 'org-key', chat_model: 'claude-sonnet-4-6', chat_base_url: null })
    const { chatModel } = await models()

    await expect(chatModel('gpt-4o', 42)).resolves.toBeTruthy()
    expect(getBillingTier).not.toHaveBeenCalled()
  })

  it('does not throw for an openai-compatible provider even with no explicit key (self-hosted proxy case)', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    getOrgAIConfig.mockResolvedValue({ chat_provider: 'openai-compatible', chat_api_key: null, chat_model: 'local-model', chat_base_url: 'http://localhost:11434' })
    const { chatModel } = await models()

    await expect(chatModel('gpt-4o', 42)).resolves.toBeTruthy()
  })

  it('a model simulation asks for does not get around it', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    getOrgAIConfig.mockResolvedValue(null)
    const { chatModel, NoAIProviderConfiguredError } = await models()

    await expect(chatModel('claude-sonnet-4-6', 42)).rejects.toBeInstanceOf(NoAIProviderConfiguredError)
  })
})

describe('chatModel — self-hosted deployments always allow the platform key', () => {
  it('falls back to the platform key without throwing when DEPLOYMENT_MODE is unset (self-hosted default)', async () => {
    getOrgAIConfig.mockResolvedValue(null)
    const { chatModel } = await models()

    await expect(chatModel('gpt-4o', 42)).resolves.toBeTruthy()
    expect(getBillingTier).not.toHaveBeenCalled()
  })
})

describe('chatModel — no orgId given (no org context at all)', () => {
  it('falls back to the platform key unconditionally, unaffected by deployment mode', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    const { chatModel } = await models()

    await expect(chatModel('gpt-4o')).resolves.toBeTruthy()
    expect(getOrgAIConfig).not.toHaveBeenCalled()
  })
})

describe('embeddingModel — same contract as chatModel', () => {
  it('throws NoAIProviderConfiguredError on cloud with no org config and no live subscription', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    getOrgAIConfig.mockResolvedValue(null)
    const { embeddingModel, NoAIProviderConfiguredError } = await models()

    await expect(embeddingModel('text-embedding-3-small', 42)).rejects.toBeInstanceOf(NoAIProviderConfiguredError)
  })

  it('does not throw on self-hosted with no org config', async () => {
    getOrgAIConfig.mockResolvedValue(null)
    const { embeddingModel } = await models()

    await expect(embeddingModel('text-embedding-3-small', 42)).resolves.toBeTruthy()
  })
})
