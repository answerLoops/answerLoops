import { describe, it, expect, vi, beforeEach } from 'vitest'

// A repo docs sync only touches files that were added, edited, removed, or
// processed under older cleanup rules. Each file goes in whole or not at all.
// A source synced before files were recorded is rebuilt once, writing them.

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
  countArticles: vi.fn(),
  countArticlesForSource: vi.fn(),
  updateRepoSettings: vi.fn(),
  listSourceFiles: vi.fn(),
  replaceFileSections: vi.fn(),
  removeSourceFile: vi.fn(),
  normalEmbed: vi.fn(),
  reprocessEmbedder: vi.fn(),
  reprocessEmbed: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/github/app', () => ({ getInstallationOctokit: h.getInstallationOctokit }))
vi.mock('@/lib/ai/embed', () => ({ embedTextWithModel: h.normalEmbed }))
vi.mock('@/lib/kb/pass-embedder', () => ({ reprocessEmbedder: h.reprocessEmbedder }))
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
  createArticleFromSource: vi.fn(),
  upsertArticleFromSource: vi.fn(),
  deleteArticleBySourceAndPage: vi.fn(),
  countArticles: h.countArticles,
  countArticlesForSource: h.countArticlesForSource,
}))
vi.mock('@/lib/db/queries/kb-source-files', () => ({
  listSourceFiles: h.listSourceFiles,
  replaceFileSections: h.replaceFileSections,
  removeSourceFile: h.removeSourceFile,
}))
vi.mock('@/lib/db/queries/github', () => ({ updateRepoSettings: h.updateRepoSettings }))

const PARA = 'This section explains the setting in enough words to be kept as an article.'
const sections = (n: number) => Array.from({ length: n }, (_, k) => `## Part ${k + 1}\n\n${PARA}`).join('\n\n')

type Blob = { path: string; sha?: string; size?: number }
// Incremental tests start from a source that already has one recorded,
// unchanged file (an existing source with sections but no records is the
// one-time rebuild instead).
const KEEP = { path: 'docs/keep.md', sha: 'k' }
let withKeep = true
function setTree(given: Blob[], truncated = false) {
  const blobs: Blob[] = withKeep && !given.some((b) => b.path === KEEP.path) ? [...given, KEEP] : given
  const dirs = new Set<string>()
  for (const b of blobs) {
    const parts = b.path.split('/')
    for (let k = 1; k < parts.length; k++) dirs.add(parts.slice(0, k).join('/'))
  }
  h.getTree.mockResolvedValue({
    data: {
      truncated,
      tree: [
        ...[...dirs].map((path) => ({ type: 'tree', path, sha: `t-${path}` })),
        ...blobs.map((b) => ({ type: 'blob', path: b.path, sha: b.sha ?? `sha-${b.path}`, size: b.size ?? 100 })),
      ],
    },
  })
}
const record = (path: string, blobSha: string, over: Record<string, number> = {}) => ({
  id: over.id ?? path.length, path, blobSha, processingVersion: over.version ?? 1, chunkCount: over.chunks ?? 2,
})
const withRecords = (rs: ReturnType<typeof record>[]) => h.listSourceFiles.mockResolvedValue([...rs, record(KEEP.path, KEEP.sha)])
const content = (text: string) => ({ data: { type: 'file', content: Buffer.from(text).toString('base64') } })

const LIVE = { id: 100, published: 1, chunk_count: 20 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  withKeep = true
  h.normalEmbed.mockReset()
  h.getContent.mockReset()
  h.getInstallationOctokit.mockResolvedValue({ rest: { git: { getTree: h.getTree }, repos: { getContent: h.getContent, getCommit: h.getCommit } } })
  h.getCommit.mockResolvedValue({ data: { sha: 'c'.repeat(40) } })
  h.getContent.mockResolvedValue(content(sections(2)))
  h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) => (f === 'acme/docs' ? LIVE : f === 'acme/docs:rebuilding' ? { id: 200, published: 0, chunk_count: 0 } : null))
  h.createKBSource.mockResolvedValue({ id: 200, published: 0 })
  h.countArticles.mockResolvedValue(20)
  h.countArticlesForSource.mockResolvedValue(20)
  h.listSourceFiles.mockResolvedValue([record(KEEP.path, KEEP.sha)])
  h.replaceFileSections.mockResolvedValue({ fileId: 1, flagged: 0 })
  h.removeSourceFile.mockResolvedValue(2)
  h.normalEmbed.mockResolvedValue({ embedding: [0.1], model: 'm' })
  h.reprocessEmbed.mockResolvedValue({ embedding: [0.2], model: 'pinned' })
  h.reprocessEmbedder.mockResolvedValue({ embed: h.reprocessEmbed, free: true })
})

async function run(kbPaths: string[] | null = ['docs'], opts = {}) {
  const { syncRepoToKB } = await import('@/lib/github/kb-sync')
  return syncRepoToKB(5, 'acme', 'docs', 1, 7, kbPaths, opts)
}
const fetched = () => h.getContent.mock.calls.map((c) => c[0].path)
const replaced = () => h.replaceFileSections.mock.calls.map((c) => c[0].path)
const saved = () => h.updateRepoSettings.mock.calls.at(-1)![2]

describe('syncRepoToKB — incremental', () => {
  it('unchanged files are not fetched or embedded', async () => {
    setTree([{ path: 'docs/a.md', sha: 's1' }, { path: 'docs/b.md', sha: 's2' }])
    withRecords([record('docs/a.md', 's1'), record('docs/b.md', 's2')])
    const { result } = await run()
    expect(h.getContent).not.toHaveBeenCalled()
    expect(h.normalEmbed).not.toHaveBeenCalled()
    expect(h.swapKBSource).not.toHaveBeenCalled()
    expect(result).toMatchObject({ unchanged: 3, updated: 0, added: 0, removed: 0, synced: 3 })
    expect(saved().kbSyncedCommit).toBe('c'.repeat(40))
  })

  it('edited file replaced', async () => {
    setTree([{ path: 'docs/a.md', sha: 'new' }])
    withRecords([record('docs/a.md', 'old', { id: 9 })])
    const { result } = await run()
    expect(fetched()).toEqual(['docs/a.md'])
    const call = h.replaceFileSections.mock.calls[0][0]
    expect(call).toMatchObject({ orgId: 7, sourceId: 100, path: 'docs/a.md', blobSha: 'new', version: 1, published: 1 })
    expect(call.sections).toHaveLength(2)
    expect(call.flag).toEqual({ label: 'acme/docs', budget: expect.objectContaining({ remaining: expect.any(Number) }) })
    expect(result.updated).toBe(1)
  })

  it('removed file deleted', async () => {
    setTree([{ path: 'docs/a.md', sha: 's1' }])
    withRecords([record('docs/a.md', 's1'), record('docs/gone.md', 's9', { id: 33 })])
    const { result } = await run()
    expect(h.removeSourceFile).toHaveBeenCalledWith({ orgId: 7, fileId: 33, flag: expect.objectContaining({ label: 'acme/docs' }) })
    expect(result).toMatchObject({ removed: 1, unchanged: 2, synced: 2 })
  })

  it('deselected folder removes its files', async () => {
    setTree([{ path: 'docs/a.md', sha: 's1' }, { path: 'guide/b.md', sha: 's2' }])
    withRecords([record('docs/a.md', 's1'), record('guide/b.md', 's2', { id: 44 })])
    await run(['docs'])
    expect(h.removeSourceFile).toHaveBeenCalledWith(expect.objectContaining({ fileId: 44 }))
  })

  it('added files in path order after edits', async () => {
    setTree([{ path: 'docs/z.md' }, { path: 'docs/a.md' }, { path: 'docs/edited.md', sha: 'new' }])
    withRecords([record('docs/edited.md', 'old')])
    await run()
    expect(replaced()).toEqual(['docs/edited.md', 'docs/a.md', 'docs/z.md'])
  })

  it('reports progress per file that needs work, with its path', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'docs/b.md' }])
    const onProgress = vi.fn()
    await run(['docs'], { onProgress })
    expect(onProgress.mock.calls.slice(0, 2)).toEqual([[0, 2, 'docs/a.md'], [1, 2, 'docs/b.md']])
    expect(onProgress).toHaveBeenLastCalledWith(2, 2)
  })

  it('edited file that outgrows room keeps old sections', async () => {
    setTree([{ path: 'docs/a.md', sha: 'new' }])
    withRecords([record('docs/a.md', 'old', { chunks: 1 })])
    h.countArticles.mockResolvedValue(1999) // room for one more section
    h.getContent.mockResolvedValue(content(sections(3))) // needs two more
    const { result } = await run()
    expect(h.replaceFileSections).not.toHaveBeenCalled()
    expect(result.skippedForRoom).toBe(1)
  })

  it('does not embed a file that will not fit', async () => {
    setTree([{ path: 'docs/a.md', sha: 'new' }, { path: 'docs/b.md' }])
    withRecords([record('docs/a.md', 'old', { chunks: 1 })])
    h.countArticles.mockResolvedValue(1999) // room for one more section
    h.getContent.mockResolvedValue(content(sections(3)))
    await run()
    expect(h.normalEmbed).not.toHaveBeenCalled()
  })

  it('applies a shrinking edit even when the workspace is over its limit', async () => {
    setTree([{ path: 'docs/a.md', sha: 'new' }])
    withRecords([record('docs/a.md', 'old', { chunks: 3 })])
    h.countArticles.mockResolvedValue(2005)
    h.getContent.mockResolvedValue(content(sections(2)))
    const { result } = await run()
    expect(replaced()).toEqual(['docs/a.md'])
    expect(result.skippedForRoom).toBe(0)
  })

  it('removed files free room for files added in the same sync', async () => {
    setTree([{ path: 'docs/new.md' }])
    withRecords([record('docs/gone.md', 'x', { id: 61 })])
    h.countArticles.mockResolvedValue(2000)
    h.removeSourceFile.mockResolvedValue(2)
    const { result } = await run()
    expect(replaced()).toEqual(['docs/new.md'])
    expect(result.added).toBe(1)
  })

  it('an empty source left by an unfinished first sync flags nothing', async () => {
    h.listSourceFiles.mockResolvedValue([])
    h.countArticlesForSource.mockResolvedValue(0)
    withKeep = false
    setTree([{ path: 'docs/a.md' }])
    await run()
    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.replaceFileSections.mock.calls[0][0]).toMatchObject({ sourceId: 100, flag: null })
  })

  it('keeps the section counts current when every file needing work failed', async () => {
    setTree([{ path: 'docs/a.md', sha: 'new' }])
    withRecords([record('docs/a.md', 'old'), record('docs/gone.md', 'x', { id: 62 })])
    h.getContent.mockRejectedValue(new Error('boom'))
    h.countArticlesForSource.mockResolvedValue(18)
    await expect(run()).rejects.toThrow(/Nothing could be imported/)
    expect(h.updateKBSourceChunkCount).toHaveBeenCalledWith(100, 18)
  })

  it('files done before a lost lease stay done', async () => {
    const { KbSyncLeaseLostError } = await import('@/lib/kb-sync/errors')
    setTree([{ path: 'docs/a.md' }, { path: 'docs/b.md' }])
    let calls = 0
    const onProgress = () => { if (++calls === 2) throw new KbSyncLeaseLostError(1) }
    await expect(run(['docs'], { onProgress })).rejects.toBeInstanceOf(KbSyncLeaseLostError)
    expect(replaced()).toEqual(['docs/a.md'])
  })

  it('new file that does not fit is skipped and reported', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'docs/b.md' }])
    h.countArticles.mockResolvedValue(1997) // room for 3: a fits (2), b does not
    const { result } = await run()
    expect(replaced()).toEqual(['docs/a.md'])
    expect(result.skippedForRoom).toBe(1)
    expect(result.added).toBe(1)
  })

  it('incremental stops fetching once full', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'docs/b.md' }, { path: 'docs/c.md' }])
    h.countArticles.mockResolvedValue(1998) // room for exactly one file
    const { result } = await run()
    expect(fetched()).toEqual(['docs/a.md'])
    expect(result.skippedForRoom).toBe(2)
  })

  it('incremental skips oversized files without fetching', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'docs/huge.md', size: 2_000_000 }])
    const { result } = await run()
    expect(fetched()).toEqual(['docs/a.md'])
    expect(result.tooLarge).toBe(1)
  })

  it('stale file uses reprocess embedder', async () => {
    setTree([{ path: 'docs/a.md', sha: 's1' }])
    withRecords([record('docs/a.md', 's1', { version: 0 })])
    const { result } = await run()
    expect(h.reprocessEmbed).toHaveBeenCalled()
    expect(h.normalEmbed).not.toHaveBeenCalled()
    expect(h.replaceFileSections.mock.calls[0][0].sections[0].model).toBe('pinned')
    expect(result.updated).toBe(1)
  })

  it('re-processing under new rules marks no resolutions, since no docs changed', async () => {
    setTree([{ path: 'docs/a.md', sha: 's1' }])
    withRecords([record('docs/a.md', 's1', { version: 0 })])
    await run()
    expect(h.replaceFileSections.mock.calls[0][0].flag).toBeNull()
  })

  it('a re-processing job only re-processes, leaving edits, new and removed files to the next push', async () => {
    setTree([{ path: 'docs/stale.md', sha: 's1' }, { path: 'docs/edited.md', sha: 'new' }, { path: 'docs/added.md' }])
    withRecords([record('docs/stale.md', 's1', { version: 0 }), record('docs/edited.md', 'old'), record('docs/gone.md', 'x', { id: 70 })])
    const { result } = await run(['docs'], { reprocessOnly: true })
    expect(replaced()).toEqual(['docs/stale.md'])
    expect(h.removeSourceFile).not.toHaveBeenCalled()
    expect(h.normalEmbed).not.toHaveBeenCalled()
    expect(result.updated).toBe(1)
    // Not every change was applied, so the commit and result aren't recorded as current.
    expect(saved()).toEqual({ kbChunkCount: 20 })
  })

  it('passes the job ownership check into every file write', async () => {
    setTree([{ path: 'docs/a.md', sha: 'new' }])
    withRecords([record('docs/a.md', 'old'), record('docs/gone.md', 'x', { id: 71 })])
    const guard = vi.fn()
    await run(['docs'], { guard })
    expect(h.replaceFileSections.mock.calls[0][0].guard).toBe(guard)
    expect(h.removeSourceFile.mock.calls[0][0].guard).toBe(guard)
  })

  it('stale file skipped when no reprocess embedder', async () => {
    setTree([{ path: 'docs/a.md', sha: 's1' }])
    withRecords([record('docs/a.md', 's1', { version: 0 })])
    h.reprocessEmbedder.mockResolvedValue(null)
    const { result } = await run()
    expect(h.getContent).not.toHaveBeenCalled()
    expect(h.normalEmbed).not.toHaveBeenCalled()
    // The stale file still answers as it is, alongside the recorded one.
    expect(result.unchanged).toBe(2)
    expect(result.updated).toBe(0)
  })

  it('lease loss before commit leaves file untouched', async () => {
    const { KbSyncLeaseLostError } = await import('@/lib/kb-sync/errors')
    setTree([{ path: 'docs/a.md' }])
    await expect(run(['docs'], { onProgress: () => { throw new KbSyncLeaseLostError(1) } })).rejects.toBeInstanceOf(KbSyncLeaseLostError)
    expect(h.replaceFileSections).not.toHaveBeenCalled()
    expect(h.updateRepoSettings).not.toHaveBeenCalled()
  })

  it('a section that fails to embed leaves the whole file as it was', async () => {
    setTree([{ path: 'docs/a.md', sha: 'new' }, { path: 'docs/b.md' }])
    withRecords([record('docs/a.md', 'old')])
    h.normalEmbed.mockResolvedValueOnce({ embedding: [0.1], model: 'm' }).mockRejectedValueOnce(new Error('timeout'))
    const { result } = await run()
    expect(replaced()).toEqual(['docs/b.md'])
    expect(result.failed).toBe(1)
  })

  it('stops the sync when no AI provider is set up, keeping files already done', async () => {
    const { NoAIProviderConfiguredError } = await import('@/lib/ai/models')
    setTree([{ path: 'docs/a.md' }, { path: 'docs/b.md' }])
    h.normalEmbed
      .mockResolvedValueOnce({ embedding: [0.1], model: 'm' })
      .mockResolvedValueOnce({ embedding: [0.1], model: 'm' })
      .mockRejectedValueOnce(new NoAIProviderConfiguredError(7))
    await expect(run()).rejects.toBeInstanceOf(NoAIProviderConfiguredError)
    expect(replaced()).toEqual(['docs/a.md'])
  })

  it('all failures throws nothing-imported', async () => {
    setTree([{ path: 'docs/a.md', sha: 'new' }])
    withRecords([record('docs/a.md', 'old')])
    h.getContent.mockRejectedValue(new Error('boom'))
    await expect(run()).rejects.toThrow(/existing knowledge base content was kept/)
  })

  it('never removes files when the tree is still incomplete', async () => {
    setTree([{ path: 'guide/a.md', sha: 's1' }], true)
    withRecords([record('guide/a.md', 's1'), record('other/b.md', 's2', { id: 55 })])
    await run(null)
    expect(h.removeSourceFile).not.toHaveBeenCalled()
  })

  it('a first sync creates the source published and flags nothing', async () => {
    withKeep = false
    h.listSourceFiles.mockResolvedValue([])
    h.getKBSourceByFilename.mockResolvedValue(null)
    h.createKBSource.mockResolvedValue({ id: 300, published: 1 })
    h.countArticles.mockResolvedValue(0)
    setTree([{ path: 'docs/a.md' }])
    const { result } = await run()
    expect(h.createKBSource).toHaveBeenCalledWith(expect.objectContaining({ filename: 'acme/docs', fileType: 'github' }))
    expect(h.replaceFileSections.mock.calls[0][0]).toMatchObject({ sourceId: 300, published: 1, flag: null })
    expect(result.added).toBe(1)
    expect(h.swapKBSource).not.toHaveBeenCalled()
  })

  it('records the final section count on the source and the repo', async () => {
    setTree([{ path: 'docs/a.md' }])
    h.countArticlesForSource.mockResolvedValue(22)
    const { chunks } = await run()
    expect(chunks).toBe(22)
    expect(h.updateKBSourceChunkCount).toHaveBeenCalledWith(100, 22)
    expect(saved().kbChunkCount).toBe(22)
  })
})

describe('syncRepoToKB — first sync after files were recorded', () => {
  beforeEach(() => {
    withKeep = false
    h.listSourceFiles.mockResolvedValue([]) // live source has 20 sections but no file rows
  })

  it('bootstrap rebuild writes records and swaps', async () => {
    setTree([{ path: 'docs/a.md' }, { path: 'docs/b.md' }])
    const { result } = await run()
    expect(h.createKBSource).toHaveBeenCalledWith(expect.objectContaining({ filename: 'acme/docs:rebuilding', published: 0 }))
    expect(h.replaceFileSections.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ sourceId: 200, path: 'docs/a.md', published: 0, flag: null, version: 1 }),
      expect.objectContaining({ sourceId: 200, path: 'docs/b.md', published: 0, flag: null, version: 1 }),
    ])
    expect(h.swapKBSource).toHaveBeenCalledWith(expect.objectContaining({ newSourceId: 200, targetFilename: 'acme/docs', published: 1, flagRelatedResolutions: true }))
    expect(result.synced).toBe(2)
  })

  it('bootstrap uses reprocess embedder when available', async () => {
    setTree([{ path: 'docs/a.md' }])
    await run()
    expect(h.reprocessEmbed).toHaveBeenCalled()
    expect(h.normalEmbed).not.toHaveBeenCalled()
  })

  it('bootstrap falls back to the normal embedder when nobody pays for re-processing', async () => {
    setTree([{ path: 'docs/a.md' }])
    h.reprocessEmbedder.mockResolvedValue(null)
    await run()
    expect(h.normalEmbed).toHaveBeenCalled()
  })

  it('bootstrap counts every file it skipped for room', async () => {
    // Room for 2: a (4 sections) is skipped, b (2) fills it, then c and d can't.
    setTree([{ path: 'docs/a.md' }, { path: 'docs/b.md' }, { path: 'docs/c.md' }, { path: 'docs/d.md' }])
    h.countArticles.mockResolvedValue(2018) // 20 of them are the live source being replaced
    h.getContent.mockImplementation(async ({ path }: { path: string }) => content(sections(path === 'docs/a.md' ? 4 : 2)))
    const { result } = await run()
    expect(replaced()).toEqual(['docs/b.md'])
    expect(result.skippedForRoom).toBe(3)
  })

  it('bootstrap does not embed a file that will not fit', async () => {
    setTree([{ path: 'docs/a.md' }])
    h.countArticles.mockResolvedValue(2019) // room for 1, the file has 2
    await run()
    expect(h.reprocessEmbed).not.toHaveBeenCalled()
  })

  it('bootstrap from an incomplete listing rebuilds from the files GitHub listed, as before', async () => {
    setTree([{ path: 'guide/a.md' }], true)
    await run(null)
    expect(replaced()).toEqual(['guide/a.md'])
    expect(h.swapKBSource).toHaveBeenCalled()
  })

  it('a re-processing job skips the rebuild when nobody would pay for it', async () => {
    setTree([{ path: 'docs/a.md' }])
    h.reprocessEmbedder.mockResolvedValue(null)
    const { chunks } = await run(['docs'], { reprocessOnly: true })
    expect(chunks).toBe(20)
    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.normalEmbed).not.toHaveBeenCalled()
    expect(h.updateRepoSettings).not.toHaveBeenCalled()
  })

  it('bootstrap keeps the live source when nothing could be written', async () => {
    setTree([{ path: 'docs/a.md' }])
    h.getContent.mockRejectedValue(new Error('boom'))
    await expect(run()).rejects.toThrow(/existing knowledge base content was kept/)
    expect(h.swapKBSource).not.toHaveBeenCalled()
    expect(h.deleteKBSource).toHaveBeenCalledWith(200, 7)
  })
})

describe('describeRepoSync — incremental', () => {
  const base = { synced: 145, skippedForRoom: 0, failed: 0, tooLarge: 0, missingFolders: [] as string[] }

  it('describeRepoSync incremental wording', async () => {
    const { describeRepoSync, describeFileChanges } = await import('@/lib/github/sync-summary')
    const r = { ...base, updated: 3, added: 1, removed: 1, unchanged: 140 }
    expect(describeFileChanges(r)).toBe('3 files updated, 1 added, 1 removed, 140 unchanged')
    expect(describeFileChanges({ ...r, updated: 0, removed: 0 })).toBe('1 file added, 140 unchanged')
    expect(describeFileChanges({ ...r, updated: 0, added: 0, removed: 0, unchanged: 0 })).toBe('no files changed')
    expect(describeFileChanges(base)).toBeNull()
    expect(describeRepoSync(r, 12)).toBe('Docs: 3 files updated, 1 added, 1 removed, 140 unchanged; 12 discussion chunks')
    expect(describeRepoSync({ ...r, skippedForRoom: 2 }, 0)).toBe(
      'Docs: 3 files updated, 1 added, 1 removed, 140 unchanged; 0 discussion chunks, 2 files skipped because the knowledge base is full'
    )
  })
})
