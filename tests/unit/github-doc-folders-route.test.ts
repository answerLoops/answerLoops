import { describe, it, expect, vi, beforeEach } from 'vitest'

// The folder list behind the docs folder picker: owners and admins only,
// scoped to the workspace, rate-limited, read from the repo's head commit, and
// honest about a tree GitHub truncated.

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  getRepoById: vi.fn(),
  getInstallationOctokit: vi.fn(),
  getCommit: vi.fn(),
  getTree: vi.fn(),
  rateLimitShared: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/github', () => ({ getRepoById: h.getRepoById }))
vi.mock('@/lib/github/app', () => ({ getInstallationOctokit: h.getInstallationOctokit }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: h.logError, debug: vi.fn() } }))
vi.mock('@/lib/request-id', () => ({ getRequestId: () => 'req' }))

import { GET } from '@/app/api/github/repos/[id]/doc-folders/route'

const repo = (over: Record<string, unknown> = {}) => ({ id: 4, owner: 'acme', repo: 'docs', kb_paths: null, ...over })

function get(id = '4') {
  return GET(new Request(`http://x/api/github/repos/${id}/doc-folders`) as never, { params: Promise.resolve({ id }) })
}

function setTree(paths: string[], truncated = false) {
  const dirs = new Set<string>()
  for (const p of paths) {
    const parts = p.split('/')
    for (let k = 1; k < parts.length; k++) dirs.add(parts.slice(0, k).join('/'))
  }
  h.getTree.mockResolvedValue({
    data: {
      truncated,
      tree: [...[...dirs].map((path) => ({ type: 'tree', path, sha: 't' })), ...paths.map((path) => ({ type: 'blob', path, sha: 'b', size: 10 }))],
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
  h.getRepoById.mockResolvedValue(repo())
  h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0 })
  h.getInstallationOctokit.mockResolvedValue({ rest: { repos: { getCommit: h.getCommit }, git: { getTree: h.getTree } } })
  h.getCommit.mockResolvedValue({ data: { sha: 'head' } })
  setTree(['docs/a.md', 'docs/api/b.mdx', 'src/x.ts', 'README.md'])
})

describe('GET /api/github/repos/[id]/doc-folders', () => {
  it('lets only owners and admins list folders', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Forbidden' })
    const res = await get()
    expect(res.status).toBe(403)
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('returns 404 for a repo in another workspace', async () => {
    h.getRepoById.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(404)
    expect(h.getRepoById).toHaveBeenCalledWith(4, 7)
    expect(h.getTree).not.toHaveBeenCalled()
  })

  it('429 after 30 folder lists', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false, retryAfterMs: 120_000 })
    const res = await get()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Rate limit reached. Try again in 2 minutes.' })
    expect(h.rateLimitShared).toHaveBeenCalledWith('doc-folders:7', 30, 600_000)
    expect(h.getTree).not.toHaveBeenCalled()
  })

  it('reads the tree at the head commit and pre-selects default folders', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(h.getTree).toHaveBeenCalledWith({ owner: 'acme', repo: 'docs', tree_sha: 'head', recursive: '1' })
    const body = await res.json()
    expect(body.selected).toEqual(['docs'])
    expect(body.usingDefaults).toBe(true)
    expect(body.missing).toEqual([])
    expect(body.truncated).toBe(false)
    const byPath = Object.fromEntries(body.folders.map((f: { path: string }) => [f.path, f]))
    expect(byPath['.']).toEqual({ path: '.', docFiles: 1, selectable: true })
    expect(byPath['docs'].docFiles).toBe(2)
    expect(byPath['src']).toBeUndefined()
  })

  it('returns the saved selection and the chosen folders that are gone', async () => {
    h.getRepoById.mockResolvedValue(repo({ kb_paths: ['docs/api', 'guide'] }))
    const body = await (await get()).json()
    expect(body.selected).toEqual(['docs/api', 'guide'])
    expect(body.usingDefaults).toBe(false)
    expect(body.missing).toEqual(['guide'])
  })

  it('reports truncated tree', async () => {
    h.getRepoById.mockResolvedValue(repo({ kb_paths: ['guide'] }))
    setTree(['docs/a.md'], true)
    const body = await (await get()).json()
    expect(body.truncated).toBe(true)
    // A truncated tree may simply not show the folder, so it is never called gone.
    expect(body.missing).toEqual([])
  })

  it('returns a plain message when GitHub cannot be read', async () => {
    h.getTree.mockRejectedValue(new Error('installation token revoked: secret detail'))
    const res = await get()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Could not read the repository. Try again shortly.' })
    expect(h.logError).toHaveBeenCalled()
  })

  it('rejects a non-numeric id', async () => {
    const res = await get('abc')
    expect(res.status).toBe(400)
  })
})
