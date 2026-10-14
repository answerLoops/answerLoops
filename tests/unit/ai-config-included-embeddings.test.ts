import { beforeEach, describe, expect, it, vi } from 'vitest'

// A hosted workspace on a trial or paid plan gets included knowledge-base
// processing. Saving a non-OpenAI chat provider with no embedding key must be
// allowed there, and Test connection must say the knowledge base will use
// included usage instead of trying (and failing) a keyless embedding call.
// Self-hosted installs and hosted workspaces without a live subscription have
// no included usage, so the embedding key stays required for them.

const h = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  saved: vi.fn(),
  tester: vi.fn(),
  tier: null as 'trial' | 'plan' | null,
  mode: 'cloud' as 'cloud' | 'self-hosted',
  embeddingModel: 'text-embedding-3-small' as string | null,
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: async () => ({ ok: true, orgId: 7 }) }))
vi.mock('@/lib/db/queries/ai-config', () => ({
  getOrgAIConfig: async () => h.existing,
  saveOrgAIConfig: (...a: unknown[]) => h.saved(...a),
  deleteOrgAIConfig: vi.fn(),
}))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: async () => true }))
vi.mock('@/lib/ai/test-connection', () => ({ testAIProviderConnection: (...a: unknown[]) => h.tester(...a) }))
vi.mock('@/lib/db/queries/billing', () => ({
  getSubscription: async () => (h.tier === 'trial' ? { status: 'trialing' } : h.tier === 'plan' ? { status: 'active' } : null),
}))
vi.mock('@/lib/billing/plans', async (orig) => ({
  ...(await orig<typeof import('@/lib/billing/plans')>()),
  getDeploymentMode: () => h.mode,
}))
vi.mock('@/lib/ai/platform-models', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/platform-models')>()),
  getPlatformModel: (role: string) => (role === 'embedding' ? h.embeddingModel : 'chat-model'),
}))

import { saveAIConfigAction, testAIConfigAction, includedEmbeddingsAvailableAction } from '@/lib/actions/ai-config'

function form(over: Record<string, string> = {}) {
  const fd = new FormData()
  const values: Record<string, string> = {
    chat_provider: 'anthropic',
    chat_model: 'claude-sonnet-4-6',
    chat_api_key: 'anthropic-key',
    embedding_provider: 'openai',
    embedding_model: 'text-embedding-3-small',
    ...over,
  }
  for (const [k, v] of Object.entries(values)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  h.existing = null
  h.saved.mockReset()
  h.tester.mockReset().mockResolvedValue({ chat: { ok: true }, embedding: { ok: true } })
  h.tier = 'trial'
  h.mode = 'cloud'
  h.embeddingModel = 'text-embedding-3-small'
})

describe('saving a non-OpenAI chat provider with no embedding key', () => {
  it.each(['trial', 'plan'] as const)('is allowed on a hosted %s', async (tier) => {
    h.tier = tier
    expect(await saveAIConfigAction(null, form())).toBeNull()
    expect(h.saved).toHaveBeenCalledWith(7, expect.objectContaining({ chat_provider: 'anthropic', embedding_api_key: null }))
  })

  it('is refused on a hosted workspace with no live subscription', async () => {
    h.tier = null
    expect(await saveAIConfigAction(null, form())).toEqual({ error: expect.stringMatching(/need their own API key/) })
    expect(h.saved).not.toHaveBeenCalled()
  })

  it('is refused on a self-hosted install', async () => {
    h.mode = 'self-hosted'
    expect(await saveAIConfigAction(null, form())).toEqual({ error: expect.stringMatching(/need their own API key/) })
  })

  it('is refused when no included embedding model is configured', async () => {
    h.embeddingModel = null
    expect(await saveAIConfigAction(null, form())).toEqual({ error: expect.stringMatching(/need their own API key/) })
  })
})

describe('Test connection with no embedding key', () => {
  it('skips the live embedding call, which would fail without a key', async () => {
    await testAIConfigAction(null, form())
    const input = h.tester.mock.calls[0][0] as { embeddingApiKey: string | null; skipEmbedding?: boolean }
    expect(input.skipEmbedding).toBe(true)
  })

  it('still runs the live embedding check when a key is entered', async () => {
    await testAIConfigAction(null, form({ embedding_api_key: 'openai-key' }))
    const input = h.tester.mock.calls[0][0] as { embeddingApiKey: string | null; skipEmbedding?: boolean }
    expect(input.embeddingApiKey).toBe('openai-key')
    expect(input.skipEmbedding).toBeFalsy()
  })

  it('still runs the live embedding check when there is no included usage', async () => {
    h.mode = 'self-hosted'
    await testAIConfigAction(null, form())
    const input = h.tester.mock.calls[0][0] as { skipEmbedding?: boolean }
    expect(input.skipEmbedding).toBeFalsy()
  })
})

describe('includedEmbeddingsAvailableAction', () => {
  it('is true on a hosted trial or plan with an included embedding model', async () => {
    expect(await includedEmbeddingsAvailableAction()).toBe(true)
    h.tier = 'plan'
    expect(await includedEmbeddingsAvailableAction()).toBe(true)
  })

  it('is false self-hosted, without a subscription, or without an included model', async () => {
    h.mode = 'self-hosted'
    expect(await includedEmbeddingsAvailableAction()).toBe(false)
    h.mode = 'cloud'; h.tier = null
    expect(await includedEmbeddingsAvailableAction()).toBe(false)
    h.tier = 'trial'; h.embeddingModel = null
    expect(await includedEmbeddingsAvailableAction()).toBe(false)
  })
})
