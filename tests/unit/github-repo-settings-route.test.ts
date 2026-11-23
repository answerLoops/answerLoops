import { describe, it, expect, vi, beforeEach } from 'vitest'

// The repo settings route stores the docs folders an owner picked, cleaned,
// and refuses an empty or unusable list.

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  updateRepoSettings: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/github', () => ({ updateRepoSettings: h.updateRepoSettings }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/request-id', () => ({ getRequestId: () => 'req' }))

import { POST } from '@/app/api/github/repo-settings/route'

function post(body: unknown) {
  return POST(new Request('http://x/api/github/repo-settings', { method: 'POST', body: JSON.stringify(body) }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
  h.updateRepoSettings.mockResolvedValue(undefined)
})

describe('POST /api/github/repo-settings — docs folders', () => {
  it('stores the cleaned folder list', async () => {
    const res = await post({ repoId: 4, kbEnabled: 1, kbPaths: ['/docs/', 'docs/api'] })
    expect(res.status).toBe(200)
    expect(h.updateRepoSettings).toHaveBeenCalledWith(4, 7, { kbEnabled: 1, kbPaths: ['docs'] })
  })

  it('refuses an empty list', async () => {
    const res = await post({ repoId: 4, kbPaths: [] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Choose at least one folder' })
    expect(h.updateRepoSettings).not.toHaveBeenCalled()
  })

  it('refuses a path that climbs out of the repository', async () => {
    const res = await post({ repoId: 4, kbPaths: ['../secrets'] })
    expect(res.status).toBe(400)
    expect(h.updateRepoSettings).not.toHaveBeenCalled()
  })

  it('leaves folders untouched when the request does not mention them', async () => {
    await post({ repoId: 4, kbEnabled: 0 })
    expect(h.updateRepoSettings).toHaveBeenCalledWith(4, 7, { kbEnabled: 0 })
  })
})
