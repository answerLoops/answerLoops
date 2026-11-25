import { describe, it, expect, vi, beforeEach } from 'vitest'

// The bot-only route behind the one-time re-processing sweep.

const h = vi.hoisted(() => ({ enqueue: vi.fn(), mode: 'cloud' }))
vi.mock('@/lib/github/docs-reprocess', () => ({ enqueueDocsReprocess: h.enqueue }))
vi.mock('@/lib/billing/plans', () => ({ getDeploymentMode: () => h.mode }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const post = (auth?: string) =>
  new Request('http://x/api/kb/docs-reprocess/run', { method: 'POST', headers: auth ? { Authorization: auth } : {} })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BOT_SECRET', 'test-bot-secret')
  h.mode = 'cloud'
  h.enqueue.mockResolvedValue({ queued: 3 })
})

describe('POST /api/kb/docs-reprocess/run', () => {
  it('returns 401 without the bot secret', async () => {
    const { POST } = await import('@/app/api/kb/docs-reprocess/run/route')
    expect((await POST(post())).status).toBe(401)
    expect((await POST(post('Bearer wrong'))).status).toBe(401)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('queues the re-processing syncs', async () => {
    const { POST } = await import('@/app/api/kb/docs-reprocess/run/route')
    const res = await POST(post('Bearer test-bot-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, queued: 3 })
  })

  it('does nothing on a self-hosted install, which has no included model', async () => {
    h.mode = 'self-hosted'
    const { POST } = await import('@/app/api/kb/docs-reprocess/run/route')
    expect(await (await POST(post('Bearer test-bot-secret'))).json()).toEqual({ ok: true, queued: 0 })
    expect(h.enqueue).not.toHaveBeenCalled()
  })
})
