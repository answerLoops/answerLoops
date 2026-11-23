import { describe, it, expect, vi, beforeEach } from 'vitest'

// The embedder background re-processing uses: free to a workspace on the
// included model with a live subscription, the workspace's own key when it
// brings one or is self-hosted, and none at all otherwise, or while an
// embedding model switch is in progress.

const h = vi.hoisted(() => ({
  cfg: null as null | Record<string, unknown>,
  tier: 'plan' as string | null,
  mode: 'cloud',
  row: { pinned: 'text-embedding-3-small' as string | null, leased: false, stray: false },
  embed: vi.fn(),
  passModel: vi.fn(),
}))

vi.mock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => h.cfg }))
vi.mock('@/lib/billing/platform-ai-budget', () => ({ getBillingTier: async () => h.tier }))
vi.mock('@/lib/billing/plans', () => ({ getDeploymentMode: () => h.mode }))
vi.mock('@/lib/ai/platform-models', () => ({ getPlatformModel: () => 'text-embedding-3-small' }))
vi.mock('@/lib/ai/embedding-pin', () => ({
  embeddingTargetFor: (cfg: Record<string, unknown> | null, platform: string | null) =>
    cfg?.own ? { modelId: 'own-embed', own: true } : platform ? { modelId: platform, own: false } : null,
}))
vi.mock('@/lib/kb/embedding-migration', () => ({ passEmbeddingModel: h.passModel }))
vi.mock('@/lib/db/drizzle', () => ({ getDb: () => ({ execute: async () => [h.row] }) }))
vi.mock('ai', () => ({ embed: h.embed }))

import { reprocessEmbedder, isFreeReprocessCandidate } from '@/lib/kb/pass-embedder'

beforeEach(() => {
  vi.clearAllMocks()
  h.cfg = null
  h.tier = 'plan'
  h.mode = 'cloud'
  h.row = { pinned: 'text-embedding-3-small', leased: false, stray: false }
  h.passModel.mockImplementation((_cfg: unknown, target: { modelId: string; own: boolean }) => ({ id: target.modelId, own: target.own }))
  h.embed.mockResolvedValue({ embedding: [0.5] })
})

describe('reprocessEmbedder', () => {
  it('free for subscribed included-model workspace', async () => {
    const e = await reprocessEmbedder(7)
    expect(e?.free).toBe(true)
    expect(h.passModel).toHaveBeenCalledWith(null, { modelId: 'text-embedding-3-small', own: false }, false)
    expect(await isFreeReprocessCandidate(7)).toBe(true)
  })

  it('own key not free', async () => {
    h.cfg = { own: true }
    h.row.pinned = 'own-embed'
    const e = await reprocessEmbedder(7)
    expect(e?.free).toBe(false)
    expect(h.passModel).toHaveBeenCalledWith(h.cfg, { modelId: 'own-embed', own: true }, false)
    expect(await isFreeReprocessCandidate(7)).toBe(false)
  })

  it('self-hosted uses own path', async () => {
    h.mode = 'self-hosted'
    h.tier = null
    const e = await reprocessEmbedder(7)
    expect(e?.free).toBe(false)
    expect(h.passModel).toHaveBeenCalledWith(null, expect.objectContaining({ modelId: 'text-embedding-3-small' }), true)
    expect(await isFreeReprocessCandidate(7)).toBe(false)
  })

  it('null without subscription on included model', async () => {
    h.tier = null
    expect(await reprocessEmbedder(7)).toBeNull()
    expect(await isFreeReprocessCandidate(7)).toBe(false)
  })

  it('null while migrating', async () => {
    h.row.leased = true
    expect(await reprocessEmbedder(7)).toBeNull()
    h.row = { pinned: 'text-embedding-3-small', leased: false, stray: true }
    expect(await reprocessEmbedder(7)).toBeNull()
    h.row = { pinned: 'other-model', leased: false, stray: false }
    expect(await reprocessEmbedder(7)).toBeNull()
  })

  it('model is the pinned id', async () => {
    const e = await reprocessEmbedder(7)
    expect(await e!.embed('Title\n\nBody')).toEqual({ embedding: [0.5], model: 'text-embedding-3-small' })
    expect(h.embed).toHaveBeenCalledWith({ model: { id: 'text-embedding-3-small', own: false }, value: 'Title\n\nBody' })
  })
})
