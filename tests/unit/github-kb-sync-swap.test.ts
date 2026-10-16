import { describe, it, expect, vi, beforeEach } from 'vitest'

// The GitHub repo and discussions syncs build the replacement source under a
// staging filename and swap it in last. The live source is never removed
// before the replacement exists, a failed build leaves it untouched, and a
// full knowledge base never causes a wipe.

const h = vi.hoisted(() => ({
  getInstallationOctokit: vi.fn(),
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

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/github/app', () => ({ getInstallationOctokit: h.getInstallationOctokit }))
vi.mock('@/lib/ai/embed', () => ({
  embedTextWithModel: async (...a: unknown[]) => ({ embedding: await h.embedText(...a), model: 'test-embed-model' }),
}))
vi.mock('@/lib/ingest/url', () => ({ chunkMarkdown: h.chunkMarkdown }))
vi.mock('@/lib/db/queries/kb-sources', () => ({
  getKBSourceByFilename: h.getKBSourceByFilename,
  createKBSource: h.createKBSource,
  deleteKBSourcesByFilename: h.deleteKBSourcesByFilename,
  deleteKBSource: h.deleteKBSource,
  updateKBSourceChunkCount: h.updateKBSourceChunkCount,
  swapKBSource: h.swapKBSource,
  getOrCreateKBSource: h.getOrCreateKBSource,
}))
vi.mock('@/lib/db/queries/kb', () => ({
  createArticleFromSource: h.createArticleFromSource,
  upsertArticleFromSource: vi.fn(),
  deleteArticleBySourceAndPage: vi.fn(),
  countArticles: h.countArticles,
  countArticlesForSource: h.countArticlesForSource,
}))
vi.mock('@/lib/db/queries/github', () => ({ updateRepoSettings: h.updateRepoSettings }))

const LIVE = 'acme/docs'
const STAGING = 'acme/docs:rebuilding'
const LIVE_DISC = 'acme/docs#discussions'
const STAGING_DISC = 'acme/docs#discussions:rebuilding'

function sourceFor(filename: string) {
  if (filename === LIVE || filename === LIVE_DISC) return { id: 100, published: 1, chunk_count: 12 }
  // The staging row this worker created (createKBSource resolves id 200).
  if (filename === STAGING || filename === STAGING_DISC) return { id: 200, published: 0, chunk_count: 0 }
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  h.getInstallationOctokit.mockResolvedValue({
    rest: { git: { getTree: h.getTree }, repos: { getContent: h.getContent } },
    auth: async () => ({ token: 'tok' }),
  })
  h.getTree.mockResolvedValue({ data: { tree: [{ type: 'blob', path: 'docs/guide.md' }] } })
  h.getContent.mockResolvedValue({ data: { type: 'file', content: Buffer.from('# Guide').toString('base64') } })
  h.chunkMarkdown.mockReturnValue([{ question: 'Q1', answer: 'A1' }, { question: 'Q2', answer: 'A2' }])
  h.getKBSourceByFilename.mockImplementation(async (_org: number, filename: string) => sourceFor(filename))
  h.createKBSource.mockResolvedValue({ id: 200 })
  h.countArticles.mockResolvedValue(12)
  h.countArticlesForSource.mockResolvedValue(12)
  h.embedText.mockResolvedValue([0.1, 0.2])
  vi.stubGlobal('fetch', h.fetch)
})

async function runRepo() {
  const { syncRepoToKB } = await import('@/lib/github/kb-sync')
  return syncRepoToKB(5, 'acme', 'docs', 1, 7)
}

async function runDiscussions() {
  const { syncDiscussionsToKB } = await import('@/lib/github/kb-sync')
  return syncDiscussionsToKB(5, 'acme', 'docs', 1, 7)
}

function discussionsResponse(nodes: unknown[]) {
  return {
    ok: true,
    json: async () => ({ data: { repository: { discussions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } }),
  }
}

describe('syncRepoToKB — staged rebuild', () => {
  it('builds under the staging filename, then swaps it over the live source once', async () => {
    const created = await runRepo()
    expect(created).toBe(2)
    expect(h.createKBSource).toHaveBeenCalledWith(expect.objectContaining({ filename: STAGING, published: 0 }))
    expect(h.createArticleFromSource).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 200, published: 0 }), 7)
    expect(h.swapKBSource).toHaveBeenCalledTimes(1)
    expect(h.swapKBSource).toHaveBeenCalledWith({ orgId: 7, newSourceId: 200, targetFilename: LIVE, published: 1 })
    // chunk count is recorded before the swap
    expect(h.updateKBSourceChunkCount.mock.invocationCallOrder[0]).toBeLessThan(h.swapKBSource.mock.invocationCallOrder[0])
  })

  it('never deletes the live source by filename', async () => {
    await runRepo()
    for (const call of h.deleteKBSourcesByFilename.mock.calls) expect(call[1]).toBe(STAGING)
  })

  it('keeps the live source when the build fails, and removes the staging rows', async () => {
    const { NoAIProviderConfiguredError } = await import('@/lib/ai/models')
    h.embedText.mockRejectedValue(new NoAIProviderConfiguredError(7))
    await expect(runRepo()).rejects.toBeInstanceOf(NoAIProviderConfiguredError)
    expect(h.swapKBSource).not.toHaveBeenCalled()
    expect(h.deleteKBSource).toHaveBeenCalledWith(200, 7)
    for (const call of h.deleteKBSourcesByFilename.mock.calls) expect(call[1]).toBe(STAGING)
  })

  it('does not swap in an empty replacement when every chunk fails to embed', async () => {
    h.embedText.mockRejectedValue(new Error('provider timeout'))
    await expect(runRepo()).rejects.toThrow(/existing knowledge base content was kept/)
    expect(h.swapKBSource).not.toHaveBeenCalled()
    expect(h.deleteKBSource).toHaveBeenCalledWith(200, 7)
  })

  it('does not count the source being replaced against the article cap', async () => {
    // 2000 articles in the org, 12 of them in this source: 12 slots are free.
    h.countArticles.mockResolvedValue(2000)
    h.chunkMarkdown.mockReturnValue(Array.from({ length: 20 }, (_, i) => ({ question: `Q${i}`, answer: 'A' })))
    const created = await runRepo()
    expect(created).toBe(12)
    expect(h.swapKBSource).toHaveBeenCalledTimes(1)
  })

  it('a full knowledge base leaves the live source untouched and returns its current size', async () => {
    h.countArticles.mockResolvedValue(2000 + 12)
    const created = await runRepo()
    expect(created).toBe(12)
    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.swapKBSource).not.toHaveBeenCalled()
    for (const call of h.deleteKBSourcesByFilename.mock.calls) expect(call[1]).toBe(STAGING)
  })

  it('clears a leftover staging row before measuring the budget', async () => {
    await runRepo()
    expect(h.deleteKBSourcesByFilename.mock.invocationCallOrder[0]).toBeLessThan(h.countArticles.mock.invocationCallOrder[0])
  })

  it('carries a hidden source\'s publish state through the swap', async () => {
    h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) => (f === LIVE ? { id: 100, published: 0, chunk_count: 3 } : f === STAGING ? { id: 200, published: 0, chunk_count: 0 } : null))
    await runRepo()
    expect(h.swapKBSource).toHaveBeenCalledWith(expect.objectContaining({ published: 0 }))
  })

  it('a first sync (nothing live) swaps in as published', async () => {
    h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) => (f === STAGING ? { id: 200, published: 0, chunk_count: 0 } : null))
    h.countArticlesForSource.mockResolvedValue(0)
    await runRepo()
    expect(h.swapKBSource).toHaveBeenCalledWith(expect.objectContaining({ published: 1 }))
  })
})

describe('syncDiscussionsToKB — staged rebuild', () => {
  const answered = { number: 3, title: 'How?', body: 'b', url: 'u', author: { login: 'a' }, answer: { body: 'Like this', author: { login: 'b' } } }

  it('builds under the staging filename and swaps over the live discussions source', async () => {
    h.fetch.mockResolvedValue(discussionsResponse([answered]))
    const created = await runDiscussions()
    expect(created).toBe(1)
    expect(h.createKBSource).toHaveBeenCalledWith(expect.objectContaining({ filename: STAGING_DISC, published: 0 }))
    expect(h.createArticleFromSource).toHaveBeenCalledWith(expect.objectContaining({ sourcePage: 3, published: 0 }), 7)
    expect(h.swapKBSource).toHaveBeenCalledWith({ orgId: 7, newSourceId: 200, targetFilename: LIVE_DISC, published: 1 })
    for (const call of h.deleteKBSourcesByFilename.mock.calls) expect(call[1]).toBe(STAGING_DISC)
  })

  it('a GraphQL failure leaves the live source untouched', async () => {
    h.fetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({ errors: [{ message: 'bad gateway' }] }) })
    await expect(runDiscussions()).rejects.toThrow()
    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.deleteKBSourcesByFilename).not.toHaveBeenCalled()
    expect(h.swapKBSource).not.toHaveBeenCalled()
  })

  it('a full knowledge base never wipes the live source', async () => {
    h.fetch.mockResolvedValue(discussionsResponse([answered]))
    h.countArticles.mockResolvedValue(2012)
    expect(await runDiscussions()).toBe(12)
    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.swapKBSource).not.toHaveBeenCalled()
  })

  it('does not swap in an empty replacement when every answered discussion fails to embed', async () => {
    h.fetch.mockResolvedValue(discussionsResponse([answered]))
    h.embedText.mockRejectedValue(new Error('provider timeout'))
    await expect(runDiscussions()).rejects.toThrow(/existing knowledge base content was kept/)
    expect(h.swapKBSource).not.toHaveBeenCalled()
  })

  it('a repo with no answered discussions is replaced by an empty source (a legitimate wipe)', async () => {
    h.fetch.mockResolvedValue(discussionsResponse([{ ...answered, answer: null }]))
    expect(await runDiscussions()).toBe(0)
    expect(h.swapKBSource).toHaveBeenCalledTimes(1)
  })

  it('records the repo total as files chunks plus discussion chunks', async () => {
    h.fetch.mockResolvedValue(discussionsResponse([answered]))
    await runDiscussions()
    expect(h.updateRepoSettings).toHaveBeenCalledWith(5, 7, expect.objectContaining({ kbChunkCount: 12 + 1 }))
  })
})

describe('staging cleanup and lease loss', () => {
  const answered = { number: 3, title: 'How?', body: 'b', url: 'u', author: { login: 'a' }, answer: { body: 'Like this', author: { login: 'b' } } }

  it('repo sync: a lease loss never deletes the staging source and rethrows', async () => {
    const { KbSyncLeaseLostError } = await import('@/lib/kb-sync/errors')
    h.embedText.mockRejectedValue(new KbSyncLeaseLostError(1))
    const { syncRepoToKB } = await import('@/lib/github/kb-sync')
    await expect(syncRepoToKB(5, 'acme', 'docs', 1, 7, {
      onProgress: () => { throw new KbSyncLeaseLostError(1) },
    })).rejects.toBeInstanceOf(KbSyncLeaseLostError)
    expect(h.deleteKBSource).not.toHaveBeenCalled()
    expect(h.swapKBSource).not.toHaveBeenCalled()
    // only the pre-build leftover clear may run, never a cleanup after the build started
    expect(h.deleteKBSourcesByFilename).toHaveBeenCalledTimes(1)
  })

  it('discussions sync: a lease loss never deletes the staging source and rethrows', async () => {
    const { KbSyncLeaseLostError } = await import('@/lib/kb-sync/errors')
    h.fetch.mockResolvedValue(discussionsResponse([answered]))
    const { syncDiscussionsToKB } = await import('@/lib/github/kb-sync')
    await expect(syncDiscussionsToKB(5, 'acme', 'docs', 1, 7, {
      onProgress: () => { throw new KbSyncLeaseLostError(1) },
    })).rejects.toBeInstanceOf(KbSyncLeaseLostError)
    expect(h.deleteKBSource).not.toHaveBeenCalled()
    expect(h.swapKBSource).not.toHaveBeenCalled()
    expect(h.deleteKBSourcesByFilename).toHaveBeenCalledTimes(1)
  })

  it('other errors still clean up, removing only the row this worker created', async () => {
    const { NoAIProviderConfiguredError } = await import('@/lib/ai/models')
    h.embedText.mockRejectedValue(new NoAIProviderConfiguredError(7))
    await expect(runRepo()).rejects.toBeInstanceOf(NoAIProviderConfiguredError)
    expect(h.deleteKBSource).toHaveBeenCalledTimes(1)
    expect(h.deleteKBSource).toHaveBeenCalledWith(200, 7)
  })

  it('repo sync: leaves the live source untouched when the staging row has vanished', async () => {
    h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) => (f === LIVE ? { id: 100, published: 1, chunk_count: 12 } : null))
    await expect(runRepo()).rejects.toThrow(/staging source no longer exists/)
    expect(h.swapKBSource).not.toHaveBeenCalled()
    expect(h.updateKBSourceChunkCount).not.toHaveBeenCalled()
  })

  it('repo sync: aborts when the staging filename now belongs to a different row', async () => {
    h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) => {
      if (f === LIVE) return { id: 100, published: 1, chunk_count: 12 }
      if (f === STAGING) return { id: 999, published: 0, chunk_count: 0 }
      return null
    })
    await expect(runRepo()).rejects.toThrow(/staging source no longer exists/)
    expect(h.swapKBSource).not.toHaveBeenCalled()
  })

  it('discussions sync: leaves the live source untouched when the staging row has vanished', async () => {
    h.fetch.mockResolvedValue(discussionsResponse([answered]))
    h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) => (f === LIVE_DISC ? { id: 100, published: 1, chunk_count: 12 } : null))
    await expect(runDiscussions()).rejects.toThrow(/staging source no longer exists/)
    expect(h.swapKBSource).not.toHaveBeenCalled()
  })
})
