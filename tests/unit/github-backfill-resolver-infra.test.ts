// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

// githubParentResolver looks a comment up through the organization's own
// installation. SQL is compiled by drizzle's pg-proxy driver; no database.

const h = vi.hoisted(() => ({ getInstallationOctokitById: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/github/app', () => ({ getInstallationOctokitById: h.getInstallationOctokitById }))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketByThreadId: vi.fn(), deleteTicket: vi.fn() }))

type Call = { sql: string; params: unknown[] }

async function makeResolver(orgId: number, reposByKey: Record<string, number>) {
  const calls: Call[] = []
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    calls.push({ sql: sqlText, params })
    // where params: org id, owner, repo, limit
    const key = `${params[0]}:${params[1]}/${params[2]}`
    return { rows: key in reposByKey ? [[reposByKey[key]]] : [] }
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
  vi.resetModules()
  const mod = await import('@/lib/github/thread-backfill')
  return { resolve: mod.githubParentResolver(orgId), calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.request.mockResolvedValue({ data: { issue_url: 'https://api.github.com/repos/o/r/issues/17' } })
  h.getInstallationOctokitById.mockResolvedValue({ request: h.request })
})

describe('githubParentResolver', () => {
  it('returns null for a discussion comment without touching the database or GitHub', async () => {
    const { resolve, calls } = await makeResolver(4, { '4:o/r': 100 })
    expect(await resolve({ owner: 'o', repo: 'r', commentId: '1', kind: 'discussion' })).toBeNull()
    expect(calls).toHaveLength(0)
    expect(h.getInstallationOctokitById).not.toHaveBeenCalled()
  })

  it('parses the issue number out of issue_url and requests the comment by numeric id', async () => {
    const { resolve } = await makeResolver(4, { '4:o/r': 100 })
    expect(await resolve({ owner: 'o', repo: 'r', commentId: '555', kind: 'issue' })).toBe(17)
    expect(h.getInstallationOctokitById).toHaveBeenCalledWith(100)
    expect(h.request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      owner: 'o', repo: 'r', comment_id: 555,
    })
  })

  it('returns null when issue_url does not end in an issue number', async () => {
    h.request.mockResolvedValue({ data: { issue_url: 'https://api.github.com/repos/o/r/pulls/x' } })
    const { resolve } = await makeResolver(4, { '4:o/r': 100 })
    expect(await resolve({ owner: 'o', repo: 'r', commentId: '1', kind: 'issue' })).toBeNull()
  })

  it('scopes the installation lookup to the given org and returns null when that org has no repo row', async () => {
    // The repo is connected under org 9 only; resolving for org 4 must not use it.
    const { resolve, calls } = await makeResolver(4, { '9:o/r': 999 })
    expect(await resolve({ owner: 'o', repo: 'r', commentId: '1', kind: 'issue' })).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql.toLowerCase()).toContain('"github_repos"."org_id" = $1')
    expect(calls[0].params.slice(0, 3)).toEqual([4, 'o', 'r'])
    expect(h.getInstallationOctokitById).not.toHaveBeenCalled()
    expect(h.request).not.toHaveBeenCalled()
  })

  it('never uses another org\'s installation', async () => {
    const { resolve } = await makeResolver(4, { '4:o/r': 100, '9:o/r': 999 })
    await resolve({ owner: 'o', repo: 'r', commentId: '1', kind: 'issue' })
    expect(h.getInstallationOctokitById).toHaveBeenCalledWith(100)
    expect(h.getInstallationOctokitById).not.toHaveBeenCalledWith(999)
  })

  it('looks the installation up once per repo and again for a different repo', async () => {
    const { resolve, calls } = await makeResolver(4, { '4:o/r': 100, '4:o/s': 200 })
    await resolve({ owner: 'o', repo: 'r', commentId: '1', kind: 'issue' })
    await resolve({ owner: 'o', repo: 'r', commentId: '2', kind: 'issue' })
    expect(calls).toHaveLength(1)
    await resolve({ owner: 'o', repo: 's', commentId: '3', kind: 'issue' })
    expect(calls).toHaveLength(2)
    expect(h.getInstallationOctokitById).toHaveBeenLastCalledWith(200)
  })

  it('caches a missing installation too, so an unconnected repo is queried once', async () => {
    const { resolve, calls } = await makeResolver(4, {})
    await resolve({ owner: 'o', repo: 'r', commentId: '1', kind: 'issue' })
    await resolve({ owner: 'o', repo: 'r', commentId: '2', kind: 'issue' })
    expect(calls).toHaveLength(1)
  })
})
