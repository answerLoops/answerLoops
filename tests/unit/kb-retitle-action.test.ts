import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Settings action behind "Update imported page titles": owners and admins
 * only, rate limited, and a bounded slice of the re-title pass per call so the
 * page can show progress.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  rateLimitShared: vi.fn(),
  runRetitlePass: vi.fn(),
  retitleStatus: vi.fn(),
}))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/kb/retitle-imports', () => ({ runRetitlePass: h.runRetitlePass, retitleStatus: h.retitleStatus }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { retitleStatusAction, runRetitleAction } from '@/lib/actions/kb-retitle'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 4 })
  h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0 })
  h.retitleStatus.mockResolvedValue({ eligibleForOwnerRun: true, remainingSources: 3 })
  h.runRetitlePass.mockResolvedValue({ retitled: 5, sourcesDone: 3, remainingSources: 0 })
})

describe('retitleStatusAction', () => {
  it('reports whether the action applies and how many pages are waiting, for owners and admins', async () => {
    expect(await retitleStatusAction()).toEqual({ eligibleForOwnerRun: true, remainingSources: 3 })
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(h.retitleStatus).toHaveBeenCalledWith(4)
  })

  it('shows nothing to anyone else', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await retitleStatusAction()).toEqual({ eligibleForOwnerRun: false, remainingSources: 0 })
    expect(h.retitleStatus).not.toHaveBeenCalled()
  })
})

describe('runRetitleAction', () => {
  it('runs one bounded owner pass and reports progress', async () => {
    expect(await runRetitleAction()).toEqual({ ok: true, retitled: 5, remainingSources: 0 })
    expect(h.runRetitlePass).toHaveBeenCalledWith(4, { mode: 'owner', maxSources: 10 })
    // Sized so one click can finish a workspace at the article cap (2,000
    // articles at 10 pages a call); the lease already stops overlapping runs.
    expect(h.rateLimitShared).toHaveBeenCalledWith('kb-retitle:4', 200, 10 * 60_000)
  })

  it('refuses anyone who is not an owner or admin, without running', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await runRetitleAction()).toEqual({ ok: false, error: 'You do not have permission to do that.' })
    expect(h.runRetitlePass).not.toHaveBeenCalled()
  })

  it('refuses when rate limited, without running', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false, retryAfterMs: 90_000 })
    expect(await runRetitleAction()).toEqual({ ok: false, error: 'Too many updates at once. Try again in 2 minutes.' })
    expect(h.runRetitlePass).not.toHaveBeenCalled()
  })

  it('explains when another update is already running', async () => {
    h.runRetitlePass.mockResolvedValue({ retitled: 0, sourcesDone: 0, remainingSources: 3, skipped: 'busy' })
    expect(await runRetitleAction()).toEqual({ ok: false, error: 'An update is already running. Try again in a few minutes.' })
  })

  it('explains when the workspace is switching embedding models', async () => {
    h.runRetitlePass.mockResolvedValue({ retitled: 0, sourcesDone: 0, remainingSources: 3, skipped: 'migrating' })
    expect(await runRetitleAction()).toEqual({
      ok: false,
      error: 'Your knowledge base is moving to a new embedding model. Try again once that has finished.',
    })
  })

  it('refuses when the action does not apply to this workspace', async () => {
    h.runRetitlePass.mockResolvedValue({ retitled: 0, sourcesDone: 0, remainingSources: 3, skipped: 'not-eligible' })
    expect(await runRetitleAction()).toEqual({ ok: false, error: 'Titles for this workspace are updated automatically.' })
  })

  it('turns an unexpected failure into a plain message', async () => {
    h.runRetitlePass.mockRejectedValue(new Error('provider down'))
    expect(await runRetitleAction()).toEqual({
      ok: false,
      error: 'The update stopped partway. Check your embedding key in Settings → AI Model, then try again.',
    })
  })
})
