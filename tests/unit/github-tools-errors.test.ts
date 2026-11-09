import { describe, it, expect, vi, beforeEach } from 'vitest'

// Repository tool failures go back into the model's context and can be quoted
// in a customer-visible draft. They must be logged server-side in full and
// returned to the model as a generic message only.

const { getInstallationOctokit, warn } = vi.hoisted(() => ({
  getInstallationOctokit: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@/lib/github/app', () => ({ getInstallationOctokit }))
vi.mock('@/lib/logger', () => ({ logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { searchCode, readFile, listFiles } from '@/lib/github/tools'

const SECRET_DETAIL = 'Repository acme/widgets is not configured (installation 98765)'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('repository tool failures', () => {
  it.each([
    ['searchCode', () => searchCode('foo', 'acme/widgets', 7)],
    ['readFile', () => readFile('README.md', 'acme/widgets', 7)],
    ['listFiles', () => listFiles('', 'acme/widgets', 7)],
  ])('%s logs the real error and returns a generic one', async (tool, call) => {
    getInstallationOctokit.mockRejectedValue(new Error(SECRET_DETAIL))

    const result = (await call()) as { error: string }

    expect(result.error).not.toContain('acme')
    expect(result.error).not.toContain('98765')
    expect(result.error).not.toContain('not configured')
    expect(warn).toHaveBeenCalledTimes(1)
    const [, fields] = warn.mock.calls[0]
    expect(fields).toMatchObject({ module: 'github-tools', tool, repo: 'acme/widgets', orgId: 7 })
    expect((fields.error as Error).message).toBe(SECRET_DETAIL)
  })

  it('tells the model a missing path does not exist, still logging it', async () => {
    getInstallationOctokit.mockResolvedValue({
      rest: { repos: { getContent: vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 })) } },
    })

    const result = (await readFile('nope.md', 'acme/widgets', 7)) as { error: string }

    expect(result.error).toBe('No file or directory exists at that path.')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toMatchObject({ status: 404, path: 'nope.md' })
  })

  it('treats a 404 from code search as unavailable, not as a missing file', async () => {
    getInstallationOctokit.mockResolvedValue({
      rest: { search: { code: vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 })) } },
    })

    const result = (await searchCode('foo', 'acme/widgets', 7)) as { error: string }

    expect(result.error).toContain('could not be read')
  })

  it('does not log on success', async () => {
    getInstallationOctokit.mockResolvedValue({
      rest: { repos: { getContent: vi.fn().mockResolvedValue({ data: [{ name: 'a.ts', type: 'file', path: 'a.ts', size: 1 }] }) } },
    })

    expect(await listFiles('', 'acme/widgets', 7)).toEqual([{ name: 'a.ts', type: 'file', path: 'a.ts', size: 1 }])
    expect(warn).not.toHaveBeenCalled()
  })
})
