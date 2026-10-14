import { describe, it, expect, vi } from 'vitest'

// Search and duplicate detection only consider vectors on a workspace's
// pinned embedding model. Mock mode (e2e) must pin new workspaces too, or a
// workspace created there never finds anything it stored.

const ensurePin = vi.fn(async (_orgId: number, m: string) => m)
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: true }))
vi.mock('@/lib/ai/embedding-pin', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/embedding-pin')>()),
  getPinnedModel: async () => null,
  ensurePin: (orgId: number, m: string) => ensurePin(orgId, m),
}))

import { resolveEmbedding } from '@/lib/ai/models'

describe('resolveEmbedding in mock mode', () => {
  it('pins a new workspace and reports the pinned model', async () => {
    expect((await resolveEmbedding('text-embedding-3-small', 9)).modelId).toBe('text-embedding-3-small')
    expect(ensurePin).toHaveBeenCalledWith(9, 'text-embedding-3-small')
  })

  it('leaves calls with no workspace alone', async () => {
    ensurePin.mockClear()
    await resolveEmbedding('text-embedding-3-small')
    expect(ensurePin).not.toHaveBeenCalled()
  })
})
