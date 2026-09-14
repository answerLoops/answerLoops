// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { runKbSync, pollKbSyncJob } from '@/lib/kb/sync-client'

// The KB page enqueues a sync then polls /api/kb/sync-jobs to completion —
// this replaces the old fire-one-request-and-block flow. These cover the
// client half: enqueue failure surfacing, label transitions, and terminal
// resolution.

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

function res(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response)
}

describe('runKbSync', () => {
  it('surfaces an enqueue error without polling', async () => {
    mockFetch.mockImplementationOnce(() => res({ error: 'Could not queue the sync' }, false))
    const label = vi.fn()
    const result = await runKbSync('/api/notion/sync-kb', '/api/kb/sync-jobs?kind=notion', label)
    expect(result.ok).toBe(false)
    expect(result.detail).toBe('Could not queue the sync')
    expect(mockFetch).toHaveBeenCalledTimes(1) // no status poll
  })

  it('POSTs the enqueue URL', async () => {
    mockFetch
      .mockImplementationOnce(() => res({ jobId: 1, status: 'queued' }))
      .mockImplementation(() => res({ status: 'succeeded', detail: 'Synced 5 chunks', syncedCount: 5 }))
    const p = runKbSync('/api/github/sync-kb?repo_id=3', '/api/kb/sync-jobs?kind=github_repo&repo_id=3', vi.fn())
    await vi.runAllTimersAsync()
    const result = await p
    expect(mockFetch.mock.calls[0]).toEqual(['/api/github/sync-kb?repo_id=3', { method: 'POST' }])
    expect(result).toEqual({ ok: true, detail: 'Synced 5 chunks', syncedCount: 5 })
  })
})

describe('pollKbSyncJob', () => {
  it('walks queued → running → succeeded, updating the label', async () => {
    mockFetch
      .mockImplementationOnce(() => res({ status: 'queued' }))
      .mockImplementationOnce(() => res({ status: 'running', progress: 0, total: 0 }))
      .mockImplementationOnce(() => res({ status: 'succeeded', detail: 'done', syncedCount: 2 }))
    const label = vi.fn()
    const p = pollKbSyncJob('/api/kb/sync-jobs?kind=notion', label)
    await vi.runAllTimersAsync()
    const result = await p
    expect(label.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['Queued…', 'Syncing…']))
    expect(result).toEqual({ ok: true, detail: 'done', syncedCount: 2 })
  })

  it('shows a count once the job reports a total', async () => {
    mockFetch
      .mockImplementationOnce(() => res({ status: 'running', progress: 12, total: 40 }))
      .mockImplementationOnce(() => res({ status: 'succeeded', detail: 'done', syncedCount: 40 }))
    const label = vi.fn()
    const p = pollKbSyncJob('/api/kb/sync-jobs?kind=github_repo&repo_id=1', label)
    await vi.runAllTimersAsync()
    await p
    expect(label).toHaveBeenCalledWith('Syncing 12/40')
  })

  it('resolves ok:false with the job detail on failure', async () => {
    mockFetch.mockImplementation(() => res({ status: 'failed', detail: 'Notion token could not be decrypted' }))
    const p = pollKbSyncJob('/api/kb/sync-jobs?kind=notion', vi.fn())
    await vi.runAllTimersAsync()
    expect(await p).toEqual({ ok: false, detail: 'Notion token could not be decrypted', syncedCount: 0 })
  })
})
