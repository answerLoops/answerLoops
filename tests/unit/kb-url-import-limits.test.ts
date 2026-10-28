import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  mapUrl: vi.fn(),
  batchScrape: vi.fn(),
  scrapeUrl: vi.fn(),
  embed: vi.fn(),
  assertEmbeddingAvailable: vi.fn(),
  countArticles: vi.fn(),
  insertWithinCap: vi.fn(),
  findExactDuplicate: vi.fn(),
  createKBSource: vi.fn(),
  deleteKBSource: vi.fn(),
  updateChunkCount: vi.fn(),
  getByFilename: vi.fn(),
  getExisting: vi.fn(),
  lookup: vi.fn(),
  rateLimitShared: vi.fn(),
  requireOrgAccess: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({ lookup: h.lookup }))
vi.mock('@mendable/firecrawl-js', () => ({
  default: class {
    mapUrl = h.mapUrl
    batchScrape = h.batchScrape
    scrapeUrl = h.scrapeUrl
  },
}))
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))
vi.mock('@/lib/ai/embed', () => ({
  embedTextWithModel: async (t: string) => ({ embedding: await h.embed(t), model: 'm' }),
  assertEmbeddingAvailable: h.assertEmbeddingAvailable,
}))
vi.mock('@/lib/db/queries/kb', () => ({ countArticles: h.countArticles }))
// The exact-duplicate lookup and the database handle it needs: nothing is a duplicate unless a test says so.
vi.mock('@/lib/db/drizzle', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/db/queries/kb-duplicates', () => ({ findExactDuplicate: h.findExactDuplicate }))
vi.mock('@/lib/db/queries/kb-article-cap', () => ({ createArticleFromSourceWithinCap: h.insertWithinCap }))
vi.mock('@/lib/db/queries/kb-sources', () => ({
  createKBSource: h.createKBSource,
  deleteKBSource: h.deleteKBSource,
  updateKBSourceChunkCount: h.updateChunkCount,
  getKBSourceByFilename: h.getByFilename,
  getExistingSourceFilenames: h.getExisting,
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))

import { chunkMarkdown, ingestSite, ingestUrl, IngestLimitError } from '@/lib/ingest/url'

const PUBLIC = [{ address: '93.184.216.34', family: 4 }]
const para = (n: number) => 'word '.repeat(n).trim()
// A page with `sections` h2 sections, each long enough to be its own chunk.
const page = (sections: number, url: string) => ({
  markdown: Array.from({ length: sections }, (_, i) => `## Section ${i}\n\n${para(30)}`).join('\n\n'),
  metadata: { sourceURL: url, title: 'T' },
})

let nextSourceId = 1
beforeEach(() => {
  vi.clearAllMocks()
  process.env.FIRECRAWL_API_KEY = 'test'
  nextSourceId = 1
  h.lookup.mockResolvedValue(PUBLIC)
  h.assertEmbeddingAvailable.mockResolvedValue(undefined)
  h.countArticles.mockResolvedValue(0)
  h.embed.mockResolvedValue([0.1])
  h.insertWithinCap.mockResolvedValue({ id: 1 })
  h.findExactDuplicate.mockResolvedValue(null)
  h.createKBSource.mockImplementation(async () => ({ id: nextSourceId++ }))
  h.deleteKBSource.mockResolvedValue(undefined)
  h.updateChunkCount.mockResolvedValue(undefined)
  h.getByFilename.mockResolvedValue(null)
  h.getExisting.mockResolvedValue(new Set())
})

describe('chunkMarkdown: heading and title length', () => {
  it('clamps an oversized heading to 300 characters', () => {
    const md = `## ${'h'.repeat(5000)}\n\n${para(30)}`
    const [chunk] = chunkMarkdown(md, 'T')
    expect(chunk.question.length).toBe(300)
  })

  it('clamps the fallback page title for heading-less pages', () => {
    const [chunk] = chunkMarkdown(para(40), 't'.repeat(900))
    expect(chunk.question.length).toBe(300)
  })

  it('clamps the title used when a heading is empty', () => {
    const chunks = chunkMarkdown(`##  \n\n${para(30)}`, 'x'.repeat(500))
    expect(chunks[0].question.length).toBe(300)
  })

  it('leaves normal headings untouched', () => {
    const [chunk] = chunkMarkdown(`## Reset your password\n\n${para(30)}`, 'T')
    expect(chunk.question).toBe('Reset your password')
  })
})

describe('site import: one shared budget for the whole run', () => {
  it('stops saving across pages once the run-wide chunk cap (150) is spent', async () => {
    h.mapUrl.mockResolvedValue({ links: [1, 2, 3, 4].map((i) => ({ url: `https://docs.example.com/p${i}` })) })
    // 4 pages x 60 sections = 240 chunks; a per-page cap would allow all 240.
    h.batchScrape.mockResolvedValue({
      data: [1, 2, 3, 4].map((i) => page(60, `https://docs.example.com/p${i}`)),
    })
    const result = await ingestSite('https://docs.example.com/', 1)
    expect(h.insertWithinCap).toHaveBeenCalledTimes(150)
    expect(result.created).toBe(150)
    // The page that found the allowance spent was never created as a source,
    // so another import can pick it up.
    expect(result.incomplete).toBe(true)
    expect(h.createKBSource).toHaveBeenCalledTimes(3)
  })

  it('shares the character allowance across pages too', async () => {
    h.mapUrl.mockResolvedValue({ links: [1, 2, 3].map((i) => ({ url: `https://docs.example.com/p${i}` })) })
    // Each chunk is ~1700 chars; 100 chunks per page is 170k chars per page.
    const big = (url: string) => ({
      markdown: Array.from({ length: 100 }, (_, i) => `## S${i}\n\n${'x'.repeat(1700)}`).join('\n\n'),
      metadata: { sourceURL: url, title: 'T' },
    })
    h.batchScrape.mockResolvedValue({ data: [1, 2, 3].map((i) => big(`https://docs.example.com/p${i}`)) })
    await ingestSite('https://docs.example.com/', 1)
    const savedChars = h.embed.mock.calls.reduce((n, c) => n + (c[0] as string).length, 0)
    expect(savedChars).toBeLessThanOrEqual(600_000 + 150 * 4)
    expect(h.insertWithinCap.mock.calls.length).toBeLessThan(300)
  })

  it('gives a single-page import its own fresh allowance', async () => {
    h.scrapeUrl.mockResolvedValue({ ...page(200, 'https://docs.example.com/x') })
    await ingestUrl('https://docs.example.com/x', 1)
    expect(h.insertWithinCap).toHaveBeenCalledTimes(150)
  })
})

describe('URL validation inside imports', () => {
  it('refuses a typed URL with an IP literal before any request is made', async () => {
    await expect(ingestSite('http://169.254.169.254/', 1)).rejects.toThrow()
    await expect(ingestUrl('http://127.0.0.1/', 1)).rejects.toThrow()
    expect(h.mapUrl).not.toHaveBeenCalled()
    expect(h.scrapeUrl).not.toHaveBeenCalled()
  })

  it('refuses a typed URL whose host resolves to a private address', async () => {
    h.lookup.mockResolvedValue([{ address: '10.0.0.4', family: 4 }])
    await expect(ingestUrl('https://docs.example.com/', 1)).rejects.toThrow()
    expect(h.scrapeUrl).not.toHaveBeenCalled()
  })

  it('drops mapped URLs that fail validation before batchScrape', async () => {
    h.lookup.mockImplementation(async (host: string) =>
      host === 'intranet.example.com' ? [{ address: '10.1.1.1', family: 4 }] : PUBLIC,
    )
    h.mapUrl.mockResolvedValue({
      links: [
        { url: 'https://docs.example.com/ok' },
        { url: 'https://intranet.example.com/hr' },
        { url: 'http://127.0.0.1/admin' },
        { url: 'https://docs.example.com:9000/odd' },
        { url: 'https://u:p@docs.example.com/cred' },
      ],
    })
    h.batchScrape.mockResolvedValue({ data: [] })
    await ingestSite('https://docs.example.com/', 1)
    expect(h.batchScrape).toHaveBeenCalledTimes(1)
    expect(h.batchScrape.mock.calls[0][0]).toEqual(['https://docs.example.com/ok'])
  })

  it('skips a page whose reported source address fails validation', async () => {
    h.mapUrl.mockResolvedValue({ links: [{ url: 'https://docs.example.com/a' }] })
    h.batchScrape.mockResolvedValue({
      data: [page(2, 'http://127.0.0.1/redirected'), page(2, 'https://docs.example.com/a')],
    })
    const result = await ingestSite('https://docs.example.com/', 1)
    expect(h.createKBSource).toHaveBeenCalledTimes(1)
    expect(h.createKBSource.mock.calls[0][0].filename).toBe('https://docs.example.com/a')
    expect(result.skipped).toBe(1)
  })
})

describe('one address check per import', () => {
  it('looks the host up once when the action runs a single-page import', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 9 })
    h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0 })
    h.scrapeUrl.mockResolvedValue(page(1, 'https://docs.example.com/x'))
    const { ingestUrlAction } = await import('@/lib/actions/ingest-url')
    const fd = new FormData()
    fd.set('url', 'https://docs.example.com/x')
    fd.set('mode', 'page')
    await ingestUrlAction(null, fd)
    expect(h.lookup).toHaveBeenCalledTimes(1)
    expect(h.scrapeUrl).toHaveBeenCalledTimes(1)
  })

  it('looks the typed host up once when the action runs a site import with a single discovered host', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 9 })
    h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0 })
    h.mapUrl.mockResolvedValue({ links: [{ url: 'https://docs.example.com/a' }] })
    h.batchScrape.mockResolvedValue({ data: [] })
    const { ingestUrlAction } = await import('@/lib/actions/ingest-url')
    const fd = new FormData()
    fd.set('url', 'https://docs.example.com/')
    fd.set('mode', 'site')
    await ingestUrlAction(null, fd)
    // One for the typed address, one for the discovered pages' host.
    expect(h.lookup).toHaveBeenCalledTimes(2)
  })

  it('still checks the address when ingestUrl is called directly', async () => {
    await expect(ingestUrl('http://10.0.0.1/', 1)).rejects.toThrow()
    h.scrapeUrl.mockResolvedValue(page(1, 'https://docs.example.com/x'))
    await ingestUrl('https://docs.example.com/x', 1)
    expect(h.lookup).toHaveBeenCalledTimes(1)
  })
})

describe('duplicate detection uses the canonical address', () => {
  it('skips a discovered page whose spelling differs from the stored canonical name', async () => {
    h.mapUrl.mockResolvedValue({ links: [{ url: 'https://Docs.Example.com' }, { url: 'https://docs.example.com/b' }] })
    // The first page is stored under its canonical name (trailing slash, lowercase host).
    h.getExisting.mockImplementation(async (_org: number, names: string[]) =>
      new Set(names.filter((n) => n === 'https://docs.example.com/')),
    )
    h.batchScrape.mockResolvedValue({ data: [page(1, 'https://docs.example.com/b')] })
    const result = await ingestSite('https://docs.example.com/', 1)
    expect(h.batchScrape.mock.calls[0][0]).toEqual(['https://docs.example.com/b'])
    expect(result.skipped).toBe(1)
  })

  it('skips a page already stored under its older raw spelling', async () => {
    h.mapUrl.mockResolvedValue({ links: [{ url: 'https://Docs.Example.com/Guide' }, { url: 'https://docs.example.com/b' }] })
    h.getExisting.mockImplementation(async (_org: number, names: string[]) =>
      new Set(names.filter((n) => n === 'https://Docs.Example.com/Guide')),
    )
    h.batchScrape.mockResolvedValue({ data: [page(1, 'https://docs.example.com/b')] })
    const result = await ingestSite('https://docs.example.com/', 1)
    expect(h.batchScrape.mock.calls[0][0]).toEqual(['https://docs.example.com/b'])
    expect(result.skipped).toBe(1)
  })

  it('treats two spellings of one page as a single page', async () => {
    h.mapUrl.mockResolvedValue({ links: [{ url: 'https://docs.example.com' }, { url: 'https://DOCS.example.com/' }] })
    h.batchScrape.mockResolvedValue({ data: [] })
    const result = await ingestSite('https://docs.example.com/', 1)
    expect(result.pagesFound).toBe(1)
    expect(h.batchScrape.mock.calls[0][0]).toEqual(['https://docs.example.com/'])
  })

  it('stores new sources under the canonical address', async () => {
    h.scrapeUrl.mockResolvedValue(page(1, 'https://docs.example.com/'))
    await ingestUrl('https://Docs.Example.com', 1)
    expect(h.createKBSource.mock.calls[0][0].filename).toBe('https://docs.example.com/')
  })

  it('skips a single-page import already stored under the typed spelling', async () => {
    h.getByFilename.mockImplementation(async (_org: number, name: string) => (name === 'https://Docs.Example.com' ? { id: 5 } : null))
    const result = await ingestUrl('https://Docs.Example.com', 1)
    expect(result).toEqual({ created: 0, skipped: true })
    expect(h.scrapeUrl).not.toHaveBeenCalled()
  })

  it('skips a scraped page whose reported address matches an older raw-form source', async () => {
    h.mapUrl.mockResolvedValue({ links: [{ url: 'https://docs.example.com/a' }] })
    h.batchScrape.mockResolvedValue({ data: [page(1, 'https://Docs.Example.com/A')] })
    h.getByFilename.mockImplementation(async (_org: number, name: string) => (name === 'https://Docs.Example.com/A' ? { id: 5 } : null))
    const result = await ingestSite('https://docs.example.com/', 1)
    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })
})

describe('orphan sources', () => {
  it('removes the source again when nothing could be saved, so a retry is not skipped', async () => {
    h.scrapeUrl.mockResolvedValue(page(3, 'https://docs.example.com/x'))
    h.embed.mockRejectedValue(new Error('embedding backend down'))
    await expect(ingestUrl('https://docs.example.com/x', 1)).rejects.toThrow('embedding backend down')
    expect(h.createKBSource).toHaveBeenCalledTimes(1)
    expect(h.deleteKBSource).toHaveBeenCalledWith(1, 1)
    expect(h.updateChunkCount).not.toHaveBeenCalled()
  })

  it('removes the source when the knowledge base is already full', async () => {
    h.scrapeUrl.mockResolvedValue(page(3, 'https://docs.example.com/x'))
    h.countArticles.mockResolvedValue(2000)
    await expect(ingestUrl('https://docs.example.com/x', 1)).rejects.toBeInstanceOf(IngestLimitError)
    expect(h.deleteKBSource).toHaveBeenCalledWith(1, 1)
  })

  it('keeps the source and its count when some chunks were saved', async () => {
    h.scrapeUrl.mockResolvedValue(page(3, 'https://docs.example.com/x'))
    const { NoAIProviderConfiguredError } = await import('@/lib/ai/models')
    h.embed.mockResolvedValueOnce([0.1]).mockRejectedValue(new NoAIProviderConfiguredError(1))
    await expect(ingestUrl('https://docs.example.com/x', 1)).rejects.toBeInstanceOf(NoAIProviderConfiguredError)
    expect(h.deleteKBSource).not.toHaveBeenCalled()
    expect(h.updateChunkCount).toHaveBeenCalledWith(1, 1)
  })

  it('does not create a source when the scrape itself fails', async () => {
    h.scrapeUrl.mockRejectedValue(new Error('scrape failed'))
    await expect(ingestUrl('https://docs.example.com/x', 1)).rejects.toThrow()
    expect(h.createKBSource).not.toHaveBeenCalled()
  })
})

describe('article ceiling is enforced by the insert', () => {
  it('stops when the atomic insert reports the workspace is full mid-run, keeping what landed', async () => {
    h.scrapeUrl.mockResolvedValue(page(5, 'https://docs.example.com/x'))
    h.insertWithinCap.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 }).mockResolvedValue(null)
    const result = await ingestUrl('https://docs.example.com/x', 1)
    expect(result.created).toBe(2)
    expect(h.insertWithinCap).toHaveBeenCalledTimes(3)
    expect(h.insertWithinCap.mock.calls[0][2]).toBe(2000)
  })

  it('reports a full knowledge base when the very first insert is refused', async () => {
    h.scrapeUrl.mockResolvedValue(page(2, 'https://docs.example.com/x'))
    h.insertWithinCap.mockResolvedValue(null)
    await expect(ingestUrl('https://docs.example.com/x', 1)).rejects.toBeInstanceOf(IngestLimitError)
    expect(h.deleteKBSource).toHaveBeenCalled()
  })
})

describe('rate-limit keys', () => {
  it('url import and the shared ingest budget use different keys', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 9 })
    h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0 })
    h.scrapeUrl.mockResolvedValue(page(1, 'https://docs.example.com/x'))

    const { ingestUrlAction } = await import('@/lib/actions/ingest-url')
    const fd = new FormData()
    fd.set('url', 'https://docs.example.com/x')
    fd.set('mode', 'page')
    await ingestUrlAction(null, fd)
    const actionKey = h.rateLimitShared.mock.calls[0][0]

    h.rateLimitShared.mockClear()
    const { isIngestRateLimited } = await import('@/lib/ingest/limits')
    await isIngestRateLimited(9)
    const ingestKey = h.rateLimitShared.mock.calls[0][0]

    expect(actionKey).toBe('kb-url-import:9')
    expect(ingestKey).toBe('ingest:9')
    expect(actionKey).not.toBe(ingestKey)
  })

  it('returns a readable error for an address that cannot be imported, without calling the importer', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 9 })
    h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0 })
    const { ingestUrlAction } = await import('@/lib/actions/ingest-url')
    const fd = new FormData()
    fd.set('url', 'http://10.0.0.1/')
    fd.set('mode', 'site')
    const res = await ingestUrlAction(null, fd)
    expect(res.error).toMatch(/website name|public/i)
    expect(h.mapUrl).not.toHaveBeenCalled()
  })

  it('maps a DNS failure to a clean message', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 9 })
    h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0 })
    h.lookup.mockRejectedValue(new Error('ENOTFOUND'))
    const { ingestUrlAction } = await import('@/lib/actions/ingest-url')
    const fd = new FormData()
    fd.set('url', 'https://does-not-exist.example.com/')
    fd.set('mode', 'page')
    const res = await ingestUrlAction(null, fd)
    expect(res.error).toBe('We could not find that website. Check the address and try again.')
  })
})

describe('exact duplicates in an import', () => {
  it('leaves out a section whose exact text is already in the knowledge base, without embedding it', async () => {
    h.scrapeUrl.mockResolvedValue({ ...page(3, 'https://docs.example.com/x') })
    h.findExactDuplicate.mockImplementation(async (_db: unknown, _org: number, q: string) => (q === 'Section 1' ? 9 : null))
    const result = await ingestUrl('https://docs.example.com/x', 1)
    expect(result).toMatchObject({ created: 2, duplicates: 1 })
    expect(h.embed).toHaveBeenCalledTimes(2)
    expect(h.insertWithinCap).toHaveBeenCalledTimes(2)
  })

  it('counts a section the insert finds is a duplicate (an import racing another)', async () => {
    h.scrapeUrl.mockResolvedValue({ ...page(3, 'https://docs.example.com/x') })
    h.insertWithinCap.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ duplicateOf: 4 }).mockResolvedValueOnce({ id: 3 })
    expect(await ingestUrl('https://docs.example.com/x', 1)).toMatchObject({ created: 2, duplicates: 1 })
  })

  it('adds nothing and fails nothing when the whole page is already in the knowledge base', async () => {
    h.scrapeUrl.mockResolvedValue({ ...page(2, 'https://docs.example.com/x') })
    h.findExactDuplicate.mockResolvedValue(9)
    expect(await ingestUrl('https://docs.example.com/x', 1)).toMatchObject({ created: 0, duplicates: 2 })
    expect(h.embed).not.toHaveBeenCalled()
  })

  it('adds up duplicates across the pages of a site import', async () => {
    h.mapUrl.mockResolvedValue({ links: [1, 2].map((i) => ({ url: `https://docs.example.com/p${i}` })) })
    h.batchScrape.mockResolvedValue({ data: [1, 2].map((i) => page(2, `https://docs.example.com/p${i}`)) })
    h.findExactDuplicate.mockResolvedValue(9)
    expect(await ingestSite('https://docs.example.com/', 1)).toMatchObject({ created: 0, duplicates: 4 })
  })
})
