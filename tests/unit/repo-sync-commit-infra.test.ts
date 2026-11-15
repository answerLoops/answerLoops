import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { githubRepos } from '@/lib/db/schema'

/**
 * Infrastructure coverage for recording which commit a repo files sync read:
 * migration 0074, the drizzle column, updateRepoSettings, and syncRepoToKB /
 * syncDiscussionsToKB. Staging and swap behaviour is covered in
 * github-kb-sync-swap.test.ts and is not repeated here.
 */

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'drizzle')
const FILE = '0074_repo_sync_commit.sql'
const raw = fs.readFileSync(path.join(DIR, FILE), 'utf8')
const code = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')

describe(`${FILE} under the migration runner`, () => {
  const chunks = raw
    .split('--> statement-breakpoint')
    .map((c) => code(c).replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  it('the runner still sorts by name and splits only on the breakpoint marker', () => {
    const runner = fs.readFileSync(path.join(ROOT, 'lib/db/migrate.ts'), 'utf8')
    expect(runner).toContain(".filter((f) => f.endsWith('.sql'))")
    expect(runner).toContain('.sort()')
    expect(runner).toContain(".split('--> statement-breakpoint')")
  })

  it('is a single terminated statement', () => {
    expect(chunks).toHaveLength(1)
    expect(chunks[0].endsWith(';')).toBe(true)
    expect(chunks[0].split(';').filter(Boolean)).toHaveLength(1)
  })

  it('is idempotent, nullable, and has no destructive SQL', () => {
    expect(chunks[0]).toBe('ALTER TABLE github_repos ADD COLUMN IF NOT EXISTS kb_synced_commit TEXT;')
    expect(chunks[0]).not.toMatch(/NOT NULL|DEFAULT/i)
    expect(code(raw)).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|RENAME)\b/i)
  })

  it('is the only 0074, numbers are unique, and it sorts after every earlier migration', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files.filter((f) => f.startsWith('0074_'))).toEqual([FILE])
    const nums = files.map((f) => Number(f.slice(0, 4)))
    expect(new Set(nums).size).toBe(nums.length)
    const idx = files.indexOf(FILE)
    expect(idx).toBeGreaterThan(0)
    // The nearest earlier migration is 0073, or 0072 when 0073 is not on this branch.
    expect(['0073_', '0072_'].some((p) => files[idx - 1].startsWith(p))).toBe(true)
    for (const f of files.slice(0, idx)) expect(Number(f.slice(0, 4))).toBeLessThan(74)
  })
})

describe('schema matches the 0074 SQL', () => {
  it('maps kbSyncedCommit to kb_synced_commit, nullable text, named in the SQL', () => {
    const col = getTableConfig(githubRepos).columns.find((c) => c.name === 'kb_synced_commit')
    expect(col).toBeDefined()
    expect(col!.notNull).toBe(false)
    expect(col!.getSQLType()).toBe('text')
    expect(col!.hasDefault).toBe(false)
    expect(githubRepos.kbSyncedCommit.name).toBe('kb_synced_commit')
    expect(raw).toContain(`ADD COLUMN IF NOT EXISTS ${col!.name} TEXT`)
    expect(raw).toContain(`ALTER TABLE ${getTableConfig(githubRepos).name} `)
  })
})

describe('updateRepoSettings', () => {
  type Call = { sql: string; params: unknown[] }
  const calls: Call[] = []

  beforeEach(() => {
    calls.length = 0
    vi.resetModules()
    vi.doUnmock('@/lib/db/queries/github')
    vi.doMock('@/lib/db/drizzle', async () => {
      const { drizzle } = await import('drizzle-orm/pg-proxy')
      const db = drizzle(async (sqlText: string, params: unknown[]) => {
        calls.push({ sql: sqlText, params })
        return { rows: [] }
      })
      return { getDb: () => db }
    })
  })

  afterEach(() => {
    vi.doUnmock('@/lib/db/drizzle')
  })

  it('writes kb_synced_commit when provided, alongside the other fields', async () => {
    const { updateRepoSettings } = await import('@/lib/db/queries/github')
    await updateRepoSettings(5, 7, { kbLastSynced: '2026-01-01T00:00:00.000Z', kbSyncedCommit: 'f'.repeat(40), kbChunkCount: 3 })
    expect(calls).toHaveLength(1)
    expect(calls[0].sql.toLowerCase()).toContain('update "github_repos" set')
    expect(calls[0].sql).toContain('"kb_synced_commit" = $')
    expect(calls[0].params).toContain('f'.repeat(40))
    expect(calls[0].sql).toContain('"kb_last_synced" = $')
    expect(calls[0].sql).toContain('"kb_chunk_count" = $')
  })

  it('leaves kb_synced_commit out of the statement when not provided', async () => {
    const { updateRepoSettings } = await import('@/lib/db/queries/github')
    await updateRepoSettings(5, 7, { kbEnabled: 1, kbChunkCount: 3 })
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).not.toContain('kb_synced_commit')
    expect(calls[0].sql).toContain('"kb_enabled" = $')
  })
})

const h = vi.hoisted(() => ({
  getInstallationOctokit: vi.fn(),
  getCommit: vi.fn(),
  getTree: vi.fn(),
  getContent: vi.fn(),
  getKBSourceByFilename: vi.fn(),
  createKBSource: vi.fn(),
  deleteKBSourcesByFilename: vi.fn(),
  deleteKBSource: vi.fn(),
  updateKBSourceChunkCount: vi.fn(),
  swapKBSource: vi.fn(),
  getOrCreateKBSource: vi.fn(),
  createArticleFromSource: vi.fn(),
  countArticles: vi.fn(),
  countArticlesForSource: vi.fn(),
  updateRepoSettings: vi.fn(),
  embedText: vi.fn(),
  chunkMarkdown: vi.fn(),
  fetch: vi.fn(),
}))

const SHA = 'c0ffee'.repeat(6) + 'abcd'

describe('syncRepoToKB / syncDiscussionsToKB record the synced commit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
    vi.doMock('@/lib/github/app', () => ({ getInstallationOctokit: h.getInstallationOctokit }))
    vi.doMock('@/lib/ai/embed', () => ({
      embedTextWithModel: async (...a: unknown[]) => ({ embedding: await h.embedText(...a), model: 'test-embed-model' }),
    }))
    vi.doMock('@/lib/ingest/url', () => ({ chunkMarkdown: h.chunkMarkdown }))
    vi.doMock('@/lib/db/queries/kb-sources', () => ({
      getKBSourceByFilename: h.getKBSourceByFilename,
      createKBSource: h.createKBSource,
      deleteKBSourcesByFilename: h.deleteKBSourcesByFilename,
      deleteKBSource: h.deleteKBSource,
      updateKBSourceChunkCount: h.updateKBSourceChunkCount,
      swapKBSource: h.swapKBSource,
      getOrCreateKBSource: h.getOrCreateKBSource,
    }))
    vi.doMock('@/lib/db/queries/kb', () => ({
      createArticleFromSource: h.createArticleFromSource,
      upsertArticleFromSource: vi.fn(),
      deleteArticleBySourceAndPage: vi.fn(),
      countArticles: h.countArticles,
      countArticlesForSource: h.countArticlesForSource,
    }))
    vi.doMock('@/lib/db/queries/github', () => ({ updateRepoSettings: h.updateRepoSettings }))

    h.getInstallationOctokit.mockResolvedValue({
      rest: { git: { getTree: h.getTree }, repos: { getContent: h.getContent, getCommit: h.getCommit } },
      auth: async () => ({ token: 'tok' }),
    })
    h.getCommit.mockResolvedValue({ data: { sha: SHA } })
    h.getTree.mockResolvedValue({
      data: {
        tree: [
          { type: 'blob', path: 'docs/guide.md' },
          { type: 'blob', path: 'docs/setup.md' },
          { type: 'blob', path: 'README.md' },
        ],
      },
    })
    h.getContent.mockResolvedValue({ data: { type: 'file', content: Buffer.from('# Guide').toString('base64') } })
    h.chunkMarkdown.mockReturnValue([{ question: 'Q1', answer: 'A1' }])
    h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) => {
      if (f === 'acme/docs' || f === 'acme/docs#discussions') return { id: 100, published: 1, chunk_count: 12 }
      if (f === 'acme/docs:rebuilding' || f === 'acme/docs#discussions:rebuilding') return { id: 200, published: 0, chunk_count: 0 }
      return null
    })
    h.createKBSource.mockResolvedValue({ id: 200 })
    h.countArticles.mockResolvedValue(12)
    h.countArticlesForSource.mockResolvedValue(12)
    h.embedText.mockResolvedValue([0.1, 0.2])
    vi.stubGlobal('fetch', h.fetch)
  })

  afterEach(() => {
    vi.doUnmock('@/lib/db/queries/github')
  })

  async function runRepo() {
    const { syncRepoToKB } = await import('@/lib/github/kb-sync')
    return syncRepoToKB(5, 'acme', 'docs', 1, 7)
  }

  const settingsKeys = () => h.updateRepoSettings.mock.calls.flatMap((c) => Object.keys(c[2] as object))

  it('resolves HEAD once, through getCommit, with the repo coordinates', async () => {
    await runRepo()
    expect(h.getCommit).toHaveBeenCalledTimes(1)
    expect(h.getCommit).toHaveBeenCalledWith({ owner: 'acme', repo: 'docs', ref: 'HEAD' })
  })

  it('reads the tree from the resolved commit sha, not the moving HEAD ref', async () => {
    await runRepo()
    expect(h.getTree).toHaveBeenCalledTimes(1)
    const arg = h.getTree.mock.calls[0][0]
    expect(arg.tree_sha).toBe(SHA)
    expect(arg.tree_sha).not.toBe('HEAD')
    // The commit is resolved before the tree is read.
    expect(h.getCommit.mock.invocationCallOrder[0]).toBeLessThan(h.getTree.mock.invocationCallOrder[0])
  })

  it('pins every file read to the same commit sha', async () => {
    await runRepo()
    expect(h.getContent).toHaveBeenCalledTimes(3)
    for (const call of h.getContent.mock.calls) expect(call[0].ref).toBe(SHA)
    expect(h.getContent.mock.calls.map((c) => c[0].path).sort()).toEqual(['README.md', 'docs/guide.md', 'docs/setup.md'])
    // still one getCommit however many files are read
    expect(h.getCommit).toHaveBeenCalledTimes(1)
  })

  it('stores the commit sha with the last-synced time and chunk count', async () => {
    await runRepo()
    expect(h.updateRepoSettings).toHaveBeenCalledTimes(1)
    expect(h.updateRepoSettings).toHaveBeenCalledWith(
      5,
      7,
      expect.objectContaining({ kbSyncedCommit: SHA, kbLastSynced: expect.any(String), kbChunkCount: expect.any(Number) }),
    )
    // recorded only after the swap succeeded
    expect(h.swapKBSource.mock.invocationCallOrder[0]).toBeLessThan(h.updateRepoSettings.mock.invocationCallOrder[0])
  })

  it('does not record a commit when the build fails', async () => {
    const { NoAIProviderConfiguredError } = await import('@/lib/ai/models')
    h.embedText.mockRejectedValue(new NoAIProviderConfiguredError(7))
    await expect(runRepo()).rejects.toBeInstanceOf(NoAIProviderConfiguredError)
    expect(h.updateRepoSettings).not.toHaveBeenCalled()
  })

  it('does not record a commit when nothing could be imported', async () => {
    h.embedText.mockRejectedValue(new Error('provider timeout'))
    await expect(runRepo()).rejects.toThrow(/existing knowledge base content was kept/)
    expect(h.updateRepoSettings).not.toHaveBeenCalled()
  })

  it('does not record a commit when the knowledge base is full', async () => {
    h.countArticles.mockResolvedValue(2012)
    expect(await runRepo()).toBe(12)
    expect(h.updateRepoSettings).not.toHaveBeenCalled()
  })

  it('does not record a commit when the commit lookup itself fails', async () => {
    h.getCommit.mockRejectedValue(new Error('404'))
    await expect(runRepo()).rejects.toThrow('404')
    expect(h.getTree).not.toHaveBeenCalled()
    expect(h.updateRepoSettings).not.toHaveBeenCalled()
  })

  it('the discussions sync never passes kbSyncedCommit and never resolves a commit', async () => {
    const answered = { number: 3, title: 'How?', body: 'b', url: 'u', author: { login: 'a' }, answer: { body: 'Like this', author: { login: 'b' } } }
    h.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { repository: { discussions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [answered] } } } }),
    })
    const { syncDiscussionsToKB } = await import('@/lib/github/kb-sync')
    expect(await syncDiscussionsToKB(5, 'acme', 'docs', 1, 7)).toBe(1)
    expect(h.updateRepoSettings).toHaveBeenCalledTimes(1)
    expect(settingsKeys()).not.toContain('kbSyncedCommit')
    expect(settingsKeys()).toContain('kbChunkCount')
    expect(h.getCommit).not.toHaveBeenCalled()
  })
})
