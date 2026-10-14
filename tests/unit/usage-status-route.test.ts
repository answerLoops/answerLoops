import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'

// GET /api/ai-config/usage-status feeds the AI Model settings card. It
// returns fractions, flags and the included model names, never amounts, and
// null when included usage doesn't apply.

describe('GET /api/ai-config/usage-status', () => {
  it("returns getBudgetStatus for the caller's org", async () => {
    vi.resetModules()
    const status = {
      tier: 'plan',
      chat: { fraction: 0.5, warning: false, exhausted: false },
      embedding: { fraction: 0, warning: false, exhausted: false },
      models: { chat: 'gpt-5.6-terra', fast: 'gpt-5.6-luna', embedding: 'text-embedding-3-small' },
    }
    vi.doMock('@/lib/auth/org', () => ({ requireOrgAccess: async () => ({ ok: true, orgId: 4 }) }))
    vi.doMock('@/lib/billing/platform-ai-budget', () => ({ getBudgetStatus: async (id: number) => (id === 4 ? status : null) }))
    const { GET } = await import('@/app/api/ai-config/usage-status/route')
    expect(await (await GET()).json()).toEqual(status)
  })

  it('401 without org access', async () => {
    vi.resetModules()
    vi.doMock('@/lib/auth/org', () => ({ requireOrgAccess: async () => ({ ok: false }) }))
    vi.doMock('@/lib/billing/platform-ai-budget', () => ({ getBudgetStatus: async () => null }))
    const { GET } = await import('@/app/api/ai-config/usage-status/route')
    expect((await GET()).status).toBe(401)
  })

  it('500 with a generic body when the lookup fails', async () => {
    vi.resetModules()
    vi.doMock('@/lib/auth/org', () => ({ requireOrgAccess: async () => ({ ok: true, orgId: 4 }) }))
    vi.doMock('@/lib/billing/platform-ai-budget', () => ({ getBudgetStatus: async () => { throw new Error('db down') } }))
    vi.doMock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    const { GET } = await import('@/app/api/ai-config/usage-status/route')
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })

  it('the old trial-status route is gone', () => {
    expect(fs.existsSync('app/api/ai-config/trial-status/route.ts')).toBe(false)
  })
})
