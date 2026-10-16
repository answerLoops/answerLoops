import { describe, it, expect, vi, beforeEach } from 'vitest'

// Behavioural coverage for the Notion KB sync data-loss fix. The old flow
// deleted the live kb_sources row FIRST, then called Notion; any outage,
// revoked token, or decrypt failure between those two points wiped the org's
// published Notion KB and left an empty source behind.
//
// The fix is fetch-first / swap-last: every Notion API call happens before any
// source row is touched, the replacement is built under a staging filename,
// and swapKBSource promotes it in one transaction. These tests prove the live
// source is never touched on a fetch failure and that the happy path swaps
// exactly once, after the build, carrying the publish choice.

const h = vi.hoisted(() => ({
  getNotionConnectionRow: vi.fn(),
  updateNotionKbState: vi.fn(),
  getKBSourceByFilename: vi.fn(),
  createKBSource: vi.fn(),
  deleteKBSourcesByFilename: vi.fn(),
  deleteKBSource: vi.fn(),
  updateKBSourceChunkCount: vi.fn(),
  swapKBSource: vi.fn(),
  createArticleFromSource: vi.fn(),
  countArticles: vi.fn(),
  notionSearchAll: vi.fn(),
  notionBlockChildren: vi.fn(),
  queryDatabaseRows: vi.fn(),
  blocksToMarkdown: vi.fn(),
  embedText: vi.fn(),
  decryptToken: vi.fn(),
  chunkMarkdown: vi.fn(),
}))

vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/ai/embed', () => ({ embedTextWithModel: async (...a: unknown[]) => ({ embedding: await h.embedText(...a), model: 'test-embed-model' }) }))
vi.mock('@/lib/crypto/tokens', () => ({ decryptToken: h.decryptToken }))
vi.mock('@/lib/ingest/url', () => ({ chunkMarkdown: h.chunkMarkdown }))
vi.mock('@/lib/db/queries/notion', () => ({
  getNotionConnectionRow: h.getNotionConnectionRow,
  updateNotionKbState: h.updateNotionKbState,
}))
vi.mock('@/lib/db/queries/kb-sources', () => ({
  getKBSourceByFilename: h.getKBSourceByFilename,
  createKBSource: h.createKBSource,
  deleteKBSourcesByFilename: h.deleteKBSourcesByFilename,
  deleteKBSource: h.deleteKBSource,
  updateKBSourceChunkCount: h.updateKBSourceChunkCount,
  swapKBSource: h.swapKBSource,
}))
vi.mock('@/lib/db/queries/kb', () => ({
  createArticleFromSource: h.createArticleFromSource,
  countArticles: h.countArticles,
}))
vi.mock('@/lib/notion/client', () => ({
  notionSearchAll: h.notionSearchAll,
  notionBlockChildren: h.notionBlockChildren,
  queryDatabaseRows: h.queryDatabaseRows,
  getNotionPageTitle: (p: { title?: string }) => p.title ?? 'Untitled',
}))
vi.mock('@/lib/notion/blocks-to-markdown', () => ({ blocksToMarkdown: h.blocksToMarkdown }))

const NOTION_SOURCE_FILENAME = 'notion:workspace'
const STAGING = 'notion:workspace:rebuilding'

// Live source lookup, plus the staging row this worker created (id 200).
function lookup(live: { id: number; published: number; chunk_count: number } | null) {
  return async (_org: number, filename: string) => {
    if (filename === STAGING) return { id: 200, published: 0, chunk_count: 0 }
    return live
  }
}

async function run(orgId = 7, opts?: { onProgress?: (d: number, t: number) => void }) {
  const { syncNotionToKB } = await import('@/lib/notion/kb-sync')
  return syncNotionToKB(orgId, opts)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  h.getNotionConnectionRow.mockResolvedValue({ accessToken: 'enc:abc' })
  h.getKBSourceByFilename.mockImplementation(lookup({ id: 100, published: 1, chunk_count: 12 }))
  h.countArticles.mockResolvedValue(12)
  h.decryptToken.mockReturnValue('ntn_realtoken')
  h.createKBSource.mockResolvedValue({ id: 200 })
  h.embedText.mockResolvedValue([0.1, 0.2])
  h.notionSearchAll.mockResolvedValue({ pages: [{ id: 'pg1', title: 'Page One' }], databases: [], pagesCapped: false, databasesCapped: false })
  h.notionBlockChildren.mockResolvedValue([{ type: 'paragraph' }])
  h.blocksToMarkdown.mockResolvedValue('# Page One\n\nBody text here.')
  h.deleteKBSourcesByFilename.mockResolvedValue(undefined)
  h.swapKBSource.mockResolvedValue(undefined)
  h.updateKBSourceChunkCount.mockResolvedValue(undefined)
  h.updateNotionKbState.mockResolvedValue(undefined)
  h.createArticleFromSource.mockResolvedValue(undefined)
  h.chunkMarkdown.mockImplementation((md: string, title: string) =>
    md.trim() ? [{ question: title, answer: md }] : [],
  )
})

describe('syncNotionToKB — fetch failure never touches the live source', () => {
  it('aborts before any source write when notionSearchAll throws', async () => {
    h.notionSearchAll.mockRejectedValue(new Error('Notion 503'))
    await expect(run()).rejects.toThrow('Notion 503')

    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.swapKBSource).not.toHaveBeenCalled()
    // The live filename is never passed to a delete helper anywhere.
    for (const call of h.deleteKBSourcesByFilename.mock.calls) {
      expect(call[1]).toBe(STAGING)
    }
  })

  it('aborts before any source write when the token cannot be decrypted', async () => {
    h.decryptToken.mockReturnValue(null)
    await expect(run()).rejects.toThrow(/could not be read/)

    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.swapKBSource).not.toHaveBeenCalled()
  })

  it('swallows a single chunk embed failure and still swaps (partial fill is acceptable)', async () => {
    h.embedText.mockRejectedValueOnce(new Error('embed timeout'))
    const res = await run()
    expect(res.synced).toBe(0)
    expect(h.swapKBSource).toHaveBeenCalledTimes(1)
    // staging row not binned on a survivable failure
    expect(h.deleteKBSourcesByFilename).toHaveBeenCalledTimes(1)
  })

  it('bins the staging row and rethrows if the build phase throws unrecoverably', async () => {
    h.chunkMarkdown.mockImplementation(() => {
      throw new Error('chunker exploded')
    })
    await expect(run()).rejects.toThrow('chunker exploded')
    expect(h.swapKBSource).not.toHaveBeenCalled()
    // once by filename to clear a stale row before the build, then only the row this worker created
    expect(h.deleteKBSourcesByFilename).toHaveBeenCalledTimes(1)
    expect(h.deleteKBSource).toHaveBeenCalledWith(200, 7)
    for (const call of h.deleteKBSourcesByFilename.mock.calls) expect(call[1]).toBe(STAGING)
  })
})

describe('syncNotionToKB — happy path swaps atomically', () => {
  it('creates the staging source then swaps it into the live filename exactly once', async () => {
    const res = await run()

    expect(h.createKBSource).toHaveBeenCalledWith(
      expect.objectContaining({ filename: STAGING, fileType: 'notion', published: 0 }),
    )
    expect(h.swapKBSource).toHaveBeenCalledTimes(1)
    expect(h.swapKBSource).toHaveBeenCalledWith(
      expect.objectContaining({ newSourceId: 200, targetFilename: NOTION_SOURCE_FILENAME, published: 1 }),
    )
    expect(res.synced).toBe(1)

    const createOrder = h.createKBSource.mock.invocationCallOrder[0]
    const swapOrder = h.swapKBSource.mock.invocationCallOrder[0]
    expect(createOrder).toBeLessThan(swapOrder)
  })

  it('carries published:0 into the swap when the workspace was never published', async () => {
    h.getKBSourceByFilename.mockImplementation(lookup({ id: 100, published: 0, chunk_count: 0 }))
    await run()
    expect(h.swapKBSource).toHaveBeenCalledWith(expect.objectContaining({ published: 0 }))
  })

  it('clears a stale staging row before building', async () => {
    await run()
    const staleClear = h.deleteKBSourcesByFilename.mock.invocationCallOrder[0]
    const createOrder = h.createKBSource.mock.invocationCallOrder[0]
    expect(h.deleteKBSourcesByFilename).toHaveBeenCalledWith(7, STAGING)
    expect(staleClear).toBeLessThan(createOrder)
  })

  it('budgets against non-Notion articles only (existing Notion chunks do not count)', async () => {
    // 12 total articles, all 12 belonging to the existing Notion source →
    // full budget still available, sync proceeds.
    h.countArticles.mockResolvedValue(12)
    h.getKBSourceByFilename.mockImplementation(lookup({ id: 100, published: 1, chunk_count: 12 }))
    const res = await run()
    expect(res.synced).toBe(1)
    expect(h.createKBSource).toHaveBeenCalled()
  })

  it('reports per-document progress and returns the search cap flags', async () => {
    h.blocksToMarkdown.mockResolvedValue('# P\n\nbody')
    h.notionSearchAll.mockResolvedValue({
      pages: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      databases: [],
      pagesCapped: true,
      databasesCapped: false,
    })
    const onProgress = vi.fn()
    const res = await run(7, { onProgress })
    expect(onProgress).toHaveBeenCalledWith(0, 2, 'A')
    expect(onProgress).toHaveBeenCalledWith(1, 2, 'B')
    expect(onProgress).toHaveBeenLastCalledWith(2, 2)
    expect(res.pagesCapped).toBe(true)
    expect(res.databasesCapped).toBe(false)
  })
})

describe('syncNotionToKB — staging cleanup and lease loss', () => {
  it('a lease loss never deletes the staging source and rethrows', async () => {
    const { KbSyncLeaseLostError } = await import('@/lib/kb-sync/errors')
    await expect(run(7, { onProgress: () => { throw new KbSyncLeaseLostError(1) } })).rejects.toBeInstanceOf(KbSyncLeaseLostError)
    expect(h.deleteKBSource).not.toHaveBeenCalled()
    expect(h.swapKBSource).not.toHaveBeenCalled()
    // only the pre-build leftover clear ran
    expect(h.deleteKBSourcesByFilename).toHaveBeenCalledTimes(1)
  })

  it('other errors still clean up the staging row this worker created', async () => {
    h.chunkMarkdown.mockImplementation(() => { throw new Error('chunker exploded') })
    await expect(run()).rejects.toThrow('chunker exploded')
    expect(h.deleteKBSource).toHaveBeenCalledTimes(1)
    expect(h.deleteKBSource).toHaveBeenCalledWith(200, 7)
  })

  it('leaves the live source untouched when the staging row has vanished', async () => {
    h.getKBSourceByFilename.mockImplementation(async (_o: number, f: string) => (f === STAGING ? null : { id: 100, published: 1, chunk_count: 12 }))
    await expect(run()).rejects.toThrow(/staging source no longer exists/)
    expect(h.swapKBSource).not.toHaveBeenCalled()
    expect(h.updateKBSourceChunkCount).not.toHaveBeenCalled()
    expect(h.updateNotionKbState).not.toHaveBeenCalled()
  })
})
