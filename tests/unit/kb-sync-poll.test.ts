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
    expect(label).toHaveBeenCalledWith('Syncing… (12/40)')
  })

  it('shows the current item title alongside the count when the job reports one', async () => {
    mockFetch
      .mockImplementationOnce(() => res({ status: 'running', progress: 12, total: 40, currentItem: 'Onboarding Guide' }))
      .mockImplementationOnce(() => res({ status: 'succeeded', detail: 'done', syncedCount: 40 }))
    const label = vi.fn()
    const p = pollKbSyncJob('/api/kb/sync-jobs?kind=notion', label)
    await vi.runAllTimersAsync()
    await p
    expect(label).toHaveBeenCalledWith('Syncing: Onboarding Guide (12/40)')
  })

  it('truncates a long current item title in the label', async () => {
    const longTitle = 'A'.repeat(80)
    mockFetch
      .mockImplementationOnce(() => res({ status: 'running', progress: 1, total: 2, currentItem: longTitle }))
      .mockImplementationOnce(() => res({ status: 'succeeded', detail: 'done', syncedCount: 2 }))
    const label = vi.fn()
    const p = pollKbSyncJob('/api/kb/sync-jobs?kind=notion', label)
    await vi.runAllTimersAsync()
    await p
    const call = label.mock.calls.find((c) => (c[0] as string).startsWith('Syncing: A'))
    expect(call?.[0]).toBe(`Syncing: ${'A'.repeat(39)}… (1/2)`)
  })

  it('resolves ok:false with the job detail on failure', async () => {
    mockFetch.mockImplementation(() => res({ status: 'failed', detail: 'Notion token could not be decrypted' }))
    const p = pollKbSyncJob('/api/kb/sync-jobs?kind=notion', vi.fn())
    await vi.runAllTimersAsync()
    expect(await p).toEqual({ ok: false, detail: 'Notion token could not be decrypted', syncedCount: 0 })
  })

  // Regression: pollKbSyncJob used to have no way to be stopped from outside
  // once started — a disconnected source, or an unmounted component, kept
  // hitting the status endpoint every 2.5s until the job reached a terminal
  // status or the 15-minute timeout, with nothing to cancel it in between.
  it('stops polling once isCancelled reports true, without waiting for a terminal status', async () => {
    mockFetch.mockImplementation(() => res({ status: 'running', progress: 1, total: 100 }))
    let cancelled = false
    const label = vi.fn()
    const p = pollKbSyncJob('/api/kb/sync-jobs?kind=notion', label, () => cancelled)

    await vi.advanceTimersByTimeAsync(2500)
    const callsBeforeCancel = mockFetch.mock.calls.length
    expect(callsBeforeCancel).toBeGreaterThan(0)

    cancelled = true
    // Let the already-scheduled retry timer fire — its isCancelled check at
    // the top of tick() is what actually resolves the promise.
    await vi.advanceTimersByTimeAsync(2500)
    const result = await p

    expect(result.ok).toBe(false)
    // No further fetches after the cancellation is observed — advancing
    // time well past several poll intervals must not grow the call count.
    const callsAtCancel = mockFetch.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockFetch.mock.calls.length).toBe(callsAtCancel)
  })

  it('checks isCancelled before the very first fetch, so a pre-cancelled call makes no request', async () => {
    const label = vi.fn()
    const result = await pollKbSyncJob('/api/kb/sync-jobs?kind=notion', label, () => true)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })
})
