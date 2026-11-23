import { describe, it, expect, vi, beforeEach } from 'vitest'

// A repo files sync reads the folders the owner picked (or every Markdown file
// when none were picked), cleans each file, titles its sections by the page,
// has no file cap, stops downloading once the knowledge base is full, skips
// files too large to sync without downloading them, and records what it did
// on the repo row.

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
  createArticleFromSource: vi.fn(),
  countArticles: vi.fn(),
  countArticlesForSource: vi.fn(),
  updateRepoSettings: vi.fn(),
  embedText: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/github/app', () => ({ getInstallationOctokit: h.getInstallationOctokit }))
vi.mock('@/lib/ai/embed', () => ({
  embedTextWithModel: async (...a: unknown[]) => ({ embedding: await h.embedText(...a), model: 'test-embed-model' }),
}))
vi.mock('@/lib/db/queries/kb-sources', () => ({
  getKBSourceByFilename: h.getKBSourceByFilename,
  createKBSource: h.createKBSource,
  deleteKBSourcesByFilename: h.deleteKBSourcesByFilename,
  deleteKBSource: h.deleteKBSource,
  updateKBSourceChunkCount: h.updateKBSourceChunkCount,
  swapKBSource: h.swapKBSource,
  getOrCreateKBSource: vi.fn(),
}))
vi.mock('@/lib/db/queries/kb', () => ({
  createArticleFromSource: h.createArticleFromSource,
  upsertArticleFromSource: vi.fn(),
  deleteArticleBySourceAndPage: vi.fn(),
  countArticles: h.countArticles,
  countArticlesForSource: h.countArticlesForSource,
}))
vi.mock('@/lib/db/queries/github', () => ({ updateRepoSettings: h.updateRepoSettings }))

type Blob = { path: string; size?: number }

// Long enough for chunkMarkdown to keep each section (it drops tiny ones).
const PARA = 'This section explains the setting in enough words to be kept as an article.'
const TWO_SECTIONS = `## One\n\n${PARA}\n\n## Two\n\n${PARA}`

function setTree(blobs: Blob[], extra: { truncated?: boolean } = {}) {
  const dirs = new Set<string>()
  for (const b of blobs) {
    const parts = b.path.split('/')
    for (let k = 1; k < parts.length; k++) dirs.add(parts.slice(0, k).join('/'))
  }
  h.getTree.mockResolvedValue({
    data: {
      truncated: extra.truncated ?? false,
      tree: [
        ...[...dirs].map((path) => ({ type: 'tree', path, sha: `t-${path}` })),
        ...blobs.map((b) => ({ type: 'blob', path: b.path, sha: `b-${b.path}`, size: b.size ?? 40 })),
      ],
    },
  })
}

function content(text: string) {
  return { data: { type: 'file', content: Buffer.from(text).toString('base64') } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  h.getInstallationOctokit.mockResolvedValue({
    rest: { git: { getTree: h.getTree }, repos: { getContent: h.getContent, getCommit: h.getCommit } },
  })
  h.getCommit.mockResolvedValue({ data: { sha: 'c'.repeat(40) } })
  h.getContent.mockResolvedValue(content(TWO_SECTIONS))
  h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) => (f === 'acme/docs:rebuilding' ? { id: 200, published: 0, chunk_count: 0 } : null))
  h.createKBSource.mockResolvedValue({ id: 200 })
  h.countArticles.mockResolvedValue(0)
  h.countArticlesForSource.mockResolvedValue(0)
  h.embedText.mockResolvedValue([0.1])
})

async function run(kbPaths: string[] | null) {
  const { syncRepoToKB } = await import('@/lib/github/kb-sync')
  return syncRepoToKB(5, 'acme', 'docs', 1, 7, kbPaths)
}

const savedResult = () => h.updateRepoSettings.mock.calls.at(-1)![2].kbSyncResult

describe('syncRepoToKB — folders and cleanup', () => {
  it('uses frontmatter title for section titles', async () => {
    setTree([{ path: 'content/docs/product/knowledge-base.mdx' }])
    h.getContent.mockResolvedValue(content(`---\ntitle: Knowledge Base\n---\n\n<Callout>${PARA}</Callout>\n\n## Add content\n\n${PARA}`))
    await run(['content/docs'])
    const questions = h.createArticleFromSource.mock.calls.map((c) => c[0].question)
    expect(questions).toContain('Knowledge Base › Add content')
    expect(questions.every((q: string) => !q.includes('content/docs'))).toBe(true)
    const answers = h.createArticleFromSource.mock.calls.map((c) => c[0].answer).join('\n')
    expect(answers).not.toContain('<Callout>')
  })

  it('chosen folders have no file cap', async () => {
    setTree(Array.from({ length: 150 }, (_, k) => ({ path: `docs/p${k}.md` })))
    const { result } = await run(['docs'])
    expect(h.getContent).toHaveBeenCalledTimes(150)
    expect(result.synced).toBe(150)
  })

  it('null paths have no file cap', async () => {
    setTree(Array.from({ length: 150 }, (_, k) => ({ path: `guide/p${k}.md` })))
    await run(null)
    expect(h.getContent).toHaveBeenCalledTimes(150)
  })

  it('only takes files inside the chosen folders', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'README.md' }, { path: 'docs/notes.txt' }])
    await run(['docs'])
    expect(h.getContent.mock.calls.map((c) => c[0].path)).toEqual(['docs/a.md', 'docs/notes.txt'])
  })

  it('article limit still bounds the sync', async () => {
    setTree(Array.from({ length: 30 }, (_, k) => ({ path: `docs/p${String(k).padStart(2, '0')}.md` })))
    h.countArticles.mockResolvedValue(1990) // room for 10 sections, 2 per file
    const { chunks, result } = await run(['docs'])
    expect(chunks).toBe(10)
    expect(result.synced).toBe(5)
    expect(result.skippedForRoom).toBe(25)
  })

  it('stops fetching once full', async () => {
    setTree(Array.from({ length: 30 }, (_, k) => ({ path: `docs/p${String(k).padStart(2, '0')}.md` })))
    h.countArticles.mockResolvedValue(1990)
    await run(['docs'])
    expect(h.getContent).toHaveBeenCalledTimes(5)
  })

  it('skips files over 1 MB without fetching', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'docs/huge.md', size: 1_048_577 }])
    const { result } = await run(['docs'])
    expect(h.getContent.mock.calls.map((c) => c[0].path)).toEqual(['docs/a.md'])
    expect(result.tooLarge).toBe(1)
  })

  it('skips empty files without fetching', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'docs/empty.md', size: 0 }])
    await run(['docs'])
    expect(h.getContent.mock.calls.map((c) => c[0].path)).toEqual(['docs/a.md'])
  })

  it('counts unreadable files as failed', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'docs/b.md' }])
    h.getContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path === 'docs/b.md') throw new Error('boom')
      return content(TWO_SECTIONS)
    })
    const { result } = await run(['docs'])
    expect(result.synced).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('records missing folders on the repo', async () => {
    setTree([{ path: 'docs/a.md' }])
    await run(['docs', 'guide'])
    expect(savedResult()).toEqual({ synced: 1, skippedForRoom: 0, failed: 0, tooLarge: 0, missingFolders: ['guide'] })
    expect(h.updateRepoSettings.mock.calls.at(-1)![2].kbSyncedCommit).toBe('c'.repeat(40))
  })

  it('reads a chosen folder on its own when the full tree is truncated', async () => {
    // The recursive tree came back cut short and does not include docs/.
    h.getTree.mockImplementation(async ({ tree_sha, recursive }: { tree_sha: string; recursive?: string }) => {
      if (tree_sha === 'c'.repeat(40) && recursive) return { data: { truncated: true, tree: [{ type: 'blob', path: 'src/x.ts', sha: 'x', size: 5 }] } }
      if (tree_sha === 'c'.repeat(40)) return { data: { truncated: false, tree: [{ type: 'tree', path: 'docs', sha: 'docs-sha' }, { type: 'tree', path: 'src', sha: 'src-sha' }] } }
      if (tree_sha === 'docs-sha' && recursive) return { data: { truncated: false, tree: [{ type: 'blob', path: 'a.md', sha: 'a', size: 40 }, { type: 'tree', path: 'api', sha: 'api' }, { type: 'blob', path: 'api/b.md', sha: 'b', size: 40 }] } }
      throw new Error(`unexpected getTree ${tree_sha} ${recursive}`)
    })
    const { result } = await run(['docs', 'guide'])
    expect(h.getContent.mock.calls.map((c) => c[0].path)).toEqual(['docs/a.md', 'docs/api/b.md'])
    expect(result.synced).toBe(2)
    expect(result.missingFolders).toEqual(['guide'])
    expect(h.swapKBSource).toHaveBeenCalled()
  })

  it('keeps the live docs when none of the chosen folders exist any more', async () => {
    setTree([{ path: 'documentation/a.md' }])
    h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) =>
      f === 'acme/docs' ? { id: 100, published: 1, chunk_count: 5 } : f === 'acme/docs:rebuilding' ? { id: 200, published: 0, chunk_count: 0 } : null
    )
    h.countArticlesForSource.mockResolvedValue(5)
    const { chunks, result } = await run(['docs'])
    expect(chunks).toBe(5)
    expect(result.missingFolders).toEqual(['docs'])
    expect(h.swapKBSource).not.toHaveBeenCalled()
    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.updateRepoSettings.mock.calls.at(-1)![2]).toEqual({ kbSyncResult: result })
  })

  it('counts a path that is not a file as failed', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'docs/link.md' }])
    h.getContent.mockImplementation(async ({ path }: { path: string }) => (path === 'docs/link.md' ? { data: { type: 'symlink' } } : content(TWO_SECTIONS)))
    const { result } = await run(['docs'])
    expect(result.failed).toBe(1)
  })

  it('swaps in a folder whose pages are all too short rather than asking to try again', async () => {
    setTree([{ path: 'docs/stub.md' }])
    h.getContent.mockResolvedValue(content('# Stub\n\nTBD'))
    h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) =>
      f === 'acme/docs' ? { id: 100, published: 1, chunk_count: 5 } : f === 'acme/docs:rebuilding' ? { id: 200, published: 0, chunk_count: 0 } : null
    )
    h.countArticlesForSource.mockResolvedValue(5)
    await expect(run(['docs'])).resolves.toBeDefined()
    expect(h.swapKBSource).toHaveBeenCalled()
  })
})

describe('describeRepoSync', () => {
  const base = { synced: 0, skippedForRoom: 0, failed: 0, tooLarge: 0, missingFolders: [] as string[] }

  it('describeRepoSync wording', async () => {
    const { describeRepoSync } = await import('@/lib/github/kb-sync')
    expect(describeRepoSync({ ...base, synced: 61 }, 12)).toBe('Synced 61 docs files and 12 discussion chunks')
    expect(describeRepoSync({ ...base, synced: 1 }, 1)).toBe('Synced 1 docs file and 1 discussion chunk')
    expect(describeRepoSync({ ...base, synced: 3, skippedForRoom: 4, failed: 2, tooLarge: 1, missingFolders: ['guide', 'api'] }, 0)).toBe(
      "Synced 3 docs files and 0 discussion chunks, 4 files skipped because the knowledge base is full, 2 files couldn't be read and will be retried, 1 file too large to sync. guide no longer exists in the repo. api no longer exists in the repo"
    )
    expect(describeRepoSync({ ...base, skippedForRoom: 1, failed: 1, tooLarge: 2 }, 0)).toBe(
      "Synced 0 docs files and 0 discussion chunks, 1 file skipped because the knowledge base is full, 1 file couldn't be read and will be retried, 2 files too large to sync"
    )
  })
})
