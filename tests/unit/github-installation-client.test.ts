import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getRepos } from '@/lib/db/queries/github'
import { getInstallationOctokit, getInstallationOctokitById } from '@/lib/github/app'

vi.mock('@/lib/db/queries/github', () => ({ getRepos: vi.fn() }))

beforeEach(() => {
  vi.stubEnv('GITHUB_APP_ID', '1')
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY', Buffer.from('<unused-test-private-key>').toString('base64'))
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

it('provides the REST methods used to discover and sync repository docs', async () => {
  const repo = {
    id: 1,
    org_id: 3,
    installation_id: 2,
    owner: 'example',
    repo: 'docs',
    is_private: 0,
    monitored_events: 'both',
    kb_enabled: 1,
    kb_last_synced: null,
    kb_synced_commit: null,
    kb_chunk_count: 0,
    kb_paths: null,
    kb_sync_result: null,
    auto_deflect_enabled: 0,
    added_at: '2026-01-01',
  } as const
  vi.mocked(getRepos).mockResolvedValue([repo])

  const client = await getInstallationOctokit('example', 'docs', 3)

  expect(getRepos).toHaveBeenCalledWith(3)
  expect(client.rest.repos.getCommit).toBeTypeOf('function')
  expect(client.rest.repos.getContent).toBeTypeOf('function')
  expect(client.rest.git.getTree).toBeTypeOf('function')
})

it('provides REST methods and raw requests for installation-scoped callers', async () => {
  const client = await getInstallationOctokitById(2)

  expect(client.rest.issues.createComment).toBeTypeOf('function')
  expect(client.request).toBeTypeOf('function')
})
