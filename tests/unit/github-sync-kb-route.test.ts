import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sync now queues a background sync for one repo. It is rate-limited per
// workspace so repeated clicks can't queue sync after sync.

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  getRepoById: vi.fn(),
  enqueueKbSyncJob: vi.fn(),
  rateLimitShared: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/github', () => ({ getRepoById: h.getRepoById }))
vi.mock('@/lib/db/queries/kb-sync-jobs', () => ({ enqueueKbSyncJob: h.enqueueKbSyncJob }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { POST } from '@/app/api/github/sync-kb/route'
import { NextRequest } from 'next/server'

const post = () => POST(new NextRequest('http://x/api/github/sync-kb?repo_id=4', { method: 'POST' }))

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
  h.getRepoById.mockResolvedValue({ id: 4 })
  h.enqueueKbSyncJob.mockResolvedValue({ id: 1, status: 'queued', created: true })
  h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0 })
})

describe('POST /api/github/sync-kb', () => {
  it('queues a sync', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.enqueueKbSyncJob).toHaveBeenCalledWith({ orgId: 7, kind: 'github_repo', repoId: 4, pullForward: true, rerunIfRunning: true })
    expect(h.rateLimitShared).toHaveBeenCalledWith('kb-sync-now:7', 10, 600_000)
  })

  it('Sync now returns 429 after 10 in the window', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false, retryAfterMs: 60_000 })
    const res = await post()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Rate limit reached. Try again in 1 minute.' })
    expect(h.enqueueKbSyncJob).not.toHaveBeenCalled()
  })
})
