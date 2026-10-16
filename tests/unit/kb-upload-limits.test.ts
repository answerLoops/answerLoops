import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  rateLimitShared: vi.fn(),
  embed: vi.fn(),
  countArticles: vi.fn(),
  insertWithinCap: vi.fn(),
  createKBSource: vi.fn(),
  deleteKBSource: vi.fn(),
  updateChunkCount: vi.fn(),
  parseFile: vi.fn(),
  chunks: [{ question: 'q', answer: 'a'.repeat(100) }] as { question: string; answer: string }[],
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/ai/embed', () => ({
  embedTextWithModel: async (t: string) => ({ embedding: await h.embed(t), model: 'm' }),
  assertEmbeddingAvailable: vi.fn(async () => {}),
}))
vi.mock('@/lib/db/queries/kb', () => ({ countArticles: h.countArticles }))
vi.mock('@/lib/db/queries/kb-article-cap', () => ({ createArticleFromSourceWithinCap: h.insertWithinCap }))
vi.mock('@/lib/db/queries/kb-sources', () => ({
  createKBSource: h.createKBSource,
  deleteKBSource: h.deleteKBSource,
  updateKBSourceChunkCount: h.updateChunkCount,
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/ingest/url', () => ({ chunkMarkdown: () => h.chunks }))
// Real helpers, with only the parser itself replaced.
vi.mock('@/lib/ingest/file-parsers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ingest/file-parsers')>('@/lib/ingest/file-parsers')
  return { ...actual, parseFile: h.parseFile }
})

import { FileParseError } from '@/lib/ingest/file-parsers'

function upload(name: string, size = 64) {
  const fd = new FormData()
  fd.append('file', new File([new Uint8Array(size)], name, { type: 'text/plain' }))
  return new Request('https://app.test/api/kb/upload', { method: 'POST', body: fd })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7, role: 'admin' })
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.countArticles.mockResolvedValue(0)
  h.createKBSource.mockResolvedValue({ id: 3 })
  h.deleteKBSource.mockResolvedValue(undefined)
  h.insertWithinCap.mockResolvedValue({ id: 1 })
  h.embed.mockResolvedValue([0.1])
  h.parseFile.mockResolvedValue('some text')
  h.chunks = [{ question: 'q', answer: 'a'.repeat(100) }]
})

describe('POST /api/kb/upload role gate', () => {
  it('requires owner or admin', async () => {
    const { POST } = await import('@/app/api/kb/upload/route')
    await POST(upload('a.txt') as never)
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
  })

  it('answers 403 when the member role is not allowed, and does no work', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('a.txt') as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('You do not have permission to do that.')
    expect(h.rateLimitShared).not.toHaveBeenCalled()
    expect(h.parseFile).not.toHaveBeenCalled()
    expect(h.createKBSource).not.toHaveBeenCalled()
  })

  it('still answers 401 when there is no signed-in member', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('a.txt') as never)
    expect(res.status).toBe(401)
  })
})

describe('POST /api/kb/upload file name handling', () => {
  it('stores and returns only the base name', async () => {
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('..\\..\\nested/dir/notes.txt') as never)
    expect(res.status).toBe(200)
    expect((await res.json()).filename).toBe('notes.txt')
    expect(h.createKBSource.mock.calls[0][0].filename).toBe('notes.txt')
  })

  it('removes control characters and limits the length to 200', async () => {
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload(`${'n'.repeat(400)}\u0007.txt`) as never)
    const name = h.createKBSource.mock.calls[0][0].filename as string
    expect(res.status).toBe(200)
    expect(name.length).toBe(200)
    expect(name.endsWith('.txt')).toBe(true)
    // eslint-disable-next-line no-control-regex
    expect(name).not.toMatch(/[\u0000-\u001f]/)
  })
})

describe('POST /api/kb/upload extracted text and parser errors', () => {
  it('rejects text over 2 MB before chunking, creating nothing', async () => {
    h.parseFile.mockResolvedValue('x'.repeat(2 * 1024 * 1024 + 1))
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('big.txt') as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/too much text/)
    expect(h.createKBSource).not.toHaveBeenCalled()
  })

  it('accepts text of exactly 2 MB', async () => {
    h.parseFile.mockResolvedValue('x'.repeat(2 * 1024 * 1024))
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('edge.txt') as never)
    expect(res.status).toBe(200)
  })

  it('counts bytes, not characters, against the text cap', async () => {
    // 700k three-byte characters is ~2.1 MB of UTF-8.
    h.parseFile.mockResolvedValue('€'.repeat(700_000))
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('euro.txt') as never)
    expect(res.status).toBe(400)
  })

  it('passes a parser limit message through as a 400', async () => {
    h.parseFile.mockRejectedValue(new FileParseError('This PDF has 900 pages. The limit is 300 pages per file.'))
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('book.txt') as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('This PDF has 900 pages. The limit is 300 pages per file.')
  })

  it('keeps the generic message for unexpected parser failures', async () => {
    h.parseFile.mockRejectedValue(new Error('internal parser detail'))
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('odd.txt') as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Failed to parse file. Check the file is not corrupted.')
  })
})

describe('POST /api/kb/upload article ceiling and orphan sources', () => {
  it('creates the source only after chunking found content', async () => {
    h.chunks = []
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('empty.txt') as never)
    expect(res.status).toBe(400)
    expect(h.createKBSource).not.toHaveBeenCalled()
  })

  it('asks the atomic insert to enforce the 2000 ceiling', async () => {
    const { POST } = await import('@/app/api/kb/upload/route')
    await POST(upload('a.txt') as never)
    expect(h.insertWithinCap).toHaveBeenCalledTimes(1)
    expect(h.insertWithinCap.mock.calls[0][1]).toBe(7)
    expect(h.insertWithinCap.mock.calls[0][2]).toBe(2000)
  })

  it('keeps what landed and reports the limit when the insert says the workspace is full mid-file', async () => {
    h.chunks = Array.from({ length: 4 }, (_, i) => ({ question: `q${i}`, answer: 'a'.repeat(100) }))
    h.insertWithinCap.mockResolvedValueOnce({ id: 1 }).mockResolvedValue(null)
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('a.txt') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.created).toBe(1)
    expect(body.error).toMatch(/full/)
    expect(h.deleteKBSource).not.toHaveBeenCalled()
    expect(h.updateChunkCount).toHaveBeenCalledWith(3, 1)
  })

  it('removes the source and answers 400 when the workspace is full from the first chunk', async () => {
    h.insertWithinCap.mockResolvedValue(null)
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('a.txt') as never)
    expect(res.status).toBe(400)
    expect(h.deleteKBSource).toHaveBeenCalledWith(3, 7)
    expect(h.updateChunkCount).not.toHaveBeenCalled()
  })

  it('removes the source and reports a failure when every chunk errors', async () => {
    h.embed.mockRejectedValue(new Error('backend down'))
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload('a.txt') as never)
    expect(res.status).toBe(502)
    expect(h.deleteKBSource).toHaveBeenCalledWith(3, 7)
  })
})
