import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'

// The bot's embedding-migration sweep POSTs here with BOT_SECRET; the app
// lists workspaces that need re-embedding and runs each, so model config
// lives only in the app service.

describe('POST /api/kb/embedding-migration/run', () => {
  it('401 without the bot secret', async () => {
    vi.resetModules()
    vi.doMock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: () => false }))
    vi.doMock('@/lib/kb/embedding-migration', () => ({ listMigrationCandidates: vi.fn(), runEmbeddingMigration: vi.fn() }))
    const { POST } = await import('@/app/api/kb/embedding-migration/run/route')
    expect((await POST(new Request('https://x.test/api', { method: 'POST' }))).status).toBe(401)
  })

  it('runs every candidate and continues past a failure', async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    const run = vi.fn(async (orgId: number) => {
      if (orgId === 2) throw new Error('boom')
      return { staged: 1, switched: true }
    })
    const list = vi.fn(async () => [1, 2, 3])
    vi.doMock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: () => true }))
    vi.doMock('@/lib/ai/platform-models', () => ({ getPlatformModel: () => 'text-embedding-3-small' }))
    vi.doMock('@/lib/kb/embedding-migration', () => ({ listMigrationCandidates: list, runEmbeddingMigration: run }))
    vi.doMock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    const { POST } = await import('@/app/api/kb/embedding-migration/run/route')
    const res = await POST(new Request('https://x.test/api', { method: 'POST' }))
    expect(await res.json()).toEqual({ ok: true, orgs: 3 })
    expect(run).toHaveBeenCalledTimes(3)
    expect(list).toHaveBeenCalledWith('text-embedding-3-small')
  })

  it('does nothing when the platform embedding model is unusable', async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    const list = vi.fn()
    vi.doMock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: () => true }))
    vi.doMock('@/lib/ai/platform-models', () => ({ getPlatformModel: () => null }))
    vi.doMock('@/lib/kb/embedding-migration', () => ({ listMigrationCandidates: list, runEmbeddingMigration: vi.fn() }))
    const { POST } = await import('@/app/api/kb/embedding-migration/run/route')
    expect(await (await POST(new Request('https://x.test/api', { method: 'POST' }))).json()).toEqual({ ok: true, orgs: 0 })
    expect(list).not.toHaveBeenCalled()
  })
})

describe('bot/index.ts', () => {
  it('runs an embedding-migration sweep against the app route with BOT_SECRET', () => {
    const s = fs.readFileSync('bot/index.ts', 'utf-8')
    expect(s).toContain('function startEmbeddingMigrationSweep()')
    expect(s).toContain('/api/kb/embedding-migration/run')
    expect(s).toMatch(/startEmbeddingMigrationSweep\(\)\s*\n/)
    const fn = s.slice(s.indexOf('function startEmbeddingMigrationSweep()'))
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/Authorization: `Bearer \$\{botSecret\}`/)
  })
})
