import { describe, it, expect, vi, beforeEach } from 'vitest'

// Behavioural checks on the internal sync run route: a worker that lost its
// job stops without recording an outcome, and the only failure text stored on
// a job is either a known owner-facing message or the generic one.

const h = vi.hoisted(() => ({
  getKbSyncJob: vi.fn(),
  finishKbSyncJob: vi.fn(),
  heartbeatKbSyncJob: vi.fn(),
  updateKbSyncJobProgress: vi.fn(),
  getRepoById: vi.fn(),
  syncNotionToKB: vi.fn(),
  syncRepoToKB: vi.fn(),
  syncDiscussionsToKB: vi.fn(),
}))

vi.mock('@/lib/db/queries/kb-sync-jobs', () => ({
  getKbSyncJob: h.getKbSyncJob,
  finishKbSyncJob: h.finishKbSyncJob,
  heartbeatKbSyncJob: h.heartbeatKbSyncJob,
  updateKbSyncJobProgress: h.updateKbSyncJobProgress,
}))
vi.mock('@/lib/db/queries/github', () => ({ getRepoById: h.getRepoById }))
vi.mock('@/lib/notion/kb-sync', () => ({ syncNotionToKB: h.syncNotionToKB }))
vi.mock('@/lib/github/kb-sync', () => ({ syncRepoToKB: h.syncRepoToKB, syncDiscussionsToKB: h.syncDiscussionsToKB }))
vi.mock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: () => true }))
// Pass every progress call straight through so each one reaches the lease check.
vi.mock('@/lib/kb-sync/progress', () => ({ throttleProgress: (sink: unknown) => sink }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { KbSyncUserError, KbSyncLeaseLostError, KB_SYNC_GENERIC_FAILURE } from '@/lib/kb-sync/errors'

const run = async () => {
  const { POST } = await import('@/app/api/kb/sync-jobs/run/route')
  return POST(new Request('https://app.test/api/kb/sync-jobs/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 5 }),
  }))
}
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  h.getKbSyncJob.mockResolvedValue({ id: 5, status: 'running', attempts: 2, kind: 'notion', org_id: 7, repo_id: null })
  h.finishKbSyncJob.mockResolvedValue(true)
  h.heartbeatKbSyncJob.mockResolvedValue(true)
  h.updateKbSyncJobProgress.mockResolvedValue(true)
})

describe('a worker that lost its lease', () => {
  it('stops at its next progress call and writes no final status', async () => {
    h.updateKbSyncJobProgress.mockResolvedValue(false) // no row matched: reclaimed elsewhere
    let afterLoss = false
    h.syncNotionToKB.mockImplementation(async (_org: number, opts: { onProgress: (d: number, t: number) => void }) => {
      opts.onProgress(1, 10)
      await tick()
      opts.onProgress(2, 10) // must throw now
      afterLoss = true
      return { synced: 10 }
    })
    const res = await run()
    expect(await res.json()).toMatchObject({ ok: true, superseded: true })
    expect(afterLoss).toBe(false)
    expect(h.finishKbSyncJob).not.toHaveBeenCalled()
  })

  it('does not record a success when the lease was lost during the last stretch of work', async () => {
    h.updateKbSyncJobProgress.mockResolvedValue(false)
    h.syncNotionToKB.mockImplementation(async (_org: number, opts: { onProgress: (d: number, t: number) => void }) => {
      opts.onProgress(10, 10)
      await tick()
      return { synced: 10 } // finishes without another progress call
    })
    const res = await run()
    expect(await res.json()).toMatchObject({ superseded: true })
    expect(h.finishKbSyncJob).not.toHaveBeenCalled()
  })

  it('reports superseded, not success, when the final write matches no row', async () => {
    h.finishKbSyncJob.mockResolvedValue(false)
    h.syncNotionToKB.mockResolvedValue({ synced: 3 })
    const res = await run()
    expect(await res.json()).toMatchObject({ ran: true, superseded: true })
    expect(await Promise.resolve(h.finishKbSyncJob.mock.calls.length)).toBe(1)
  })

  it('a lease-lost error thrown by the sync itself is not written as a failure', async () => {
    h.syncNotionToKB.mockRejectedValue(new KbSyncLeaseLostError(5))
    const res = await run()
    expect(await res.json()).toMatchObject({ superseded: true })
    expect(h.finishKbSyncJob).not.toHaveBeenCalled()
  })

  it('every write is made for the claimed attempt', async () => {
    h.syncNotionToKB.mockImplementation(async (_org: number, opts: { onProgress: (d: number, t: number) => void }) => {
      opts.onProgress(1, 2)
      return { synced: 2 }
    })
    await run()
    expect(h.updateKbSyncJobProgress).toHaveBeenCalledWith(5, 2, 1, 2, undefined)
    expect(h.finishKbSyncJob).toHaveBeenCalledWith(5, 2, expect.objectContaining({ status: 'succeeded', syncedCount: 2 }), expect.any(Number))
  })
})

describe('failure text stored on the job', () => {
  const stored = () => (h.finishKbSyncJob.mock.calls[0][2] as { status: string; detail: string })

  const unknownErrors: [string, unknown][] = [
    ['a plain error carrying internal detail', new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2')],
    ['a type error', new TypeError("Cannot read properties of undefined (reading 'id')")],
    ['an error naming a file path', new Error('ENOENT: no such file or directory, open /srv/app/.env')],
    ['a thrown string', 'raw string failure token=abc'],
    ['a thrown object', { message: 'raw object failure', code: 'XX001' }],
  ]

  for (const [label, err] of unknownErrors) {
    it(`stores only the generic text for ${label}`, async () => {
      h.syncNotionToKB.mockRejectedValue(err)
      const res = await run()
      expect(await res.json()).toMatchObject({ ok: true, ran: true, failed: true })
      expect(stored()).toEqual({ status: 'failed', detail: KB_SYNC_GENERIC_FAILURE })
    })
  }

  it('stores the message of a known owner-facing error as written', async () => {
    h.syncNotionToKB.mockRejectedValue(new KbSyncUserError('Reconnect Notion and sync again.'))
    await run()
    expect(stored()).toEqual({ status: 'failed', detail: 'Reconnect Notion and sync again.' })
  })

  it('does not leak the message of an unrecognised error subclass', async () => {
    class OddError extends Error {}
    h.syncNotionToKB.mockRejectedValue(new OddError('internal table kb_articles locked'))
    await run()
    expect(stored().detail).toBe(KB_SYNC_GENERIC_FAILURE)
  })

  it('uses the generic text for an unknown job kind and for a repo job without a repo', async () => {
    h.getKbSyncJob.mockResolvedValue({ id: 5, status: 'running', attempts: 1, kind: 'mystery', org_id: 7, repo_id: null })
    await run()
    expect(stored().detail).toBe(KB_SYNC_GENERIC_FAILURE)

    vi.clearAllMocks()
    h.finishKbSyncJob.mockResolvedValue(true)
    h.getKbSyncJob.mockResolvedValue({ id: 5, status: 'running', attempts: 1, kind: 'github_repo', org_id: 7, repo_id: null })
    await run()
    expect(stored().detail).toBe(KB_SYNC_GENERIC_FAILURE)
  })

  it('tells the owner the repository is gone when it was disconnected, and nothing more', async () => {
    h.getKbSyncJob.mockResolvedValue({ id: 5, status: 'running', attempts: 1, kind: 'github_repo', org_id: 7, repo_id: 9 })
    h.getRepoById.mockResolvedValue(null)
    await run()
    expect(stored().detail).toMatch(/no longer connected/)
  })

  it('does nothing for a job that is not running', async () => {
    h.getKbSyncJob.mockResolvedValue({ id: 5, status: 'succeeded', attempts: 1, kind: 'notion', org_id: 7 })
    const res = await run()
    expect(await res.json()).toMatchObject({ ran: false })
    expect(h.syncNotionToKB).not.toHaveBeenCalled()
    expect(h.finishKbSyncJob).not.toHaveBeenCalled()
  })
})
