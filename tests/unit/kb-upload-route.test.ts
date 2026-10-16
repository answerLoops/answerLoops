import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  rateLimitShared: vi.fn(),
  embedText: vi.fn(),
  assertEmbeddingAvailable: vi.fn(),
  countArticles: vi.fn(),
  createArticleFromSource: vi.fn(),
  createKBSource: vi.fn(),
  updateKBSourceChunkCount: vi.fn(),
  deleteKBSource: vi.fn(),
  chunks: [{ question: 'q', answer: 'a'.repeat(100) }] as { question: string; answer: string }[],
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/ai/embed', () => ({
  embedTextWithModel: async (text: string, orgId?: number) => ({ embedding: await h.embedText(text, orgId), model: 'm' }),
  assertEmbeddingAvailable: h.assertEmbeddingAvailable,
}))
vi.mock('@/lib/db/queries/kb', () => ({ countArticles: h.countArticles }))
vi.mock('@/lib/db/queries/kb-article-cap', () => ({ createArticleFromSourceWithinCap: h.createArticleFromSource }))
vi.mock('@/lib/db/queries/kb-sources', () => ({
  createKBSource: h.createKBSource,
  updateKBSourceChunkCount: h.updateKBSourceChunkCount,
  deleteKBSource: h.deleteKBSource,
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/ingest/url', () => ({
  chunkMarkdown: () => h.chunks,
}))
vi.mock('@/lib/ingest/file-parsers', () => ({
  detectFileType: (n: string) => (n.endsWith('.txt') ? 'txt' : null),
  parseFile: async () => 'some text',
  normalizeFileName: (n: string) => n,
  MAX_EXTRACTED_TEXT_BYTES: 2 * 1024 * 1024,
  FileParseError: class FileParseError extends Error {},
}))

import { NoAIProviderConfiguredError, PlatformBudgetExhaustedError } from '@/lib/ai/models'

function upload(size: number, extraHeaders: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('file', new File([new Uint8Array(size)], 'a.txt', { type: 'text/plain' }))
  return new Request('https://app.test/api/kb/upload', { method: 'POST', body: fd, headers: extraHeaders })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.assertEmbeddingAvailable.mockResolvedValue(undefined)
  h.countArticles.mockResolvedValue(0)
  h.createKBSource.mockResolvedValue({ id: 3 })
  h.chunks = [{ question: 'q', answer: 'a'.repeat(100) }]
  h.embedText.mockResolvedValue([0.1])
  h.createArticleFromSource.mockResolvedValue({ id: 1 })
  h.deleteKBSource.mockResolvedValue(undefined)
})

describe('app/api/kb/upload/route.ts', () => {
  it('uses the shared rate limiter', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: false, retryAfterMs: 60_000 })
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload(10) as never)
    expect(res.status).toBe(429)
    expect(h.rateLimitShared).toHaveBeenCalledWith('kb-upload:7', 10, 600_000)
  })

  it('rejects an oversized declared Content-Length before reading the body', async () => {
    const { POST } = await import('@/app/api/kb/upload/route')
    const req = new Request('https://app.test/api/kb/upload', {
      method: 'POST',
      headers: { 'content-length': String(50 * 1024 * 1024), 'content-type': 'multipart/form-data; boundary=x' },
      body: 'x',
    })
    const res = await POST(req as never)
    expect(res.status).toBe(413)
  })

  it('rejects a body that exceeds the cap while streaming even without a truthful Content-Length', async () => {
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload(11 * 1024 * 1024) as never)
    expect(res.status).toBe(413)
    expect((await res.json()).error).toContain('10 MB')
    expect(h.createKBSource).not.toHaveBeenCalled()
  })

  it('accepts a file under the cap and embeds with the org id', async () => {
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload(1024) as never)
    expect(res.status).toBe(200)
    expect(h.embedText).toHaveBeenCalledWith(expect.any(String), 7)
    expect(h.createArticleFromSource).toHaveBeenCalled()
  })

  it('returns the included-usage message, and creates nothing, when knowledge-base processing is used up', async () => {
    const err = new PlatformBudgetExhaustedError(7, 'embedding', 'plan')
    h.assertEmbeddingAvailable.mockRejectedValue(err)
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload(1024) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(err.userMessage)
    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.embedText).not.toHaveBeenCalled()
  })

  it('returns a clear error and creates nothing when no AI provider is configured', async () => {
    h.assertEmbeddingAvailable.mockRejectedValue(new NoAIProviderConfiguredError(7))
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload(1024) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('No AI provider')
    expect(h.createKBSource).not.toHaveBeenCalled()
    expect(h.embedText).not.toHaveBeenCalled()
  })
})

describe('app/api/kb/upload/route.ts — included usage runs out mid-file', () => {
  // Every remaining chunk would fail the same way, so the upload stops at the
  // first one, keeps what it added, and says how far it got and why, instead
  // of returning success with a smaller count.
  const five = () => Array.from({ length: 5 }, (_, i) => ({ question: `q${i}`, answer: 'a'.repeat(100) }))

  it('stops at the first chunk that runs out, keeps the rest, and reports both the count and the reason', async () => {
    h.chunks = five()
    const err = new PlatformBudgetExhaustedError(7, 'embedding', 'trial')
    h.embedText.mockResolvedValueOnce([0.1]).mockResolvedValueOnce([0.1]).mockRejectedValue(err)
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload(1024) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.created).toBe(2)
    expect(body.error).toBe(`Added 2 of 5 sections from a.txt. ${err.userMessage}`)
    expect(h.embedText).toHaveBeenCalledTimes(3)
    expect(h.updateKBSourceChunkCount).toHaveBeenCalledWith(3, 2)
  })

  it('returns the reason as a 400 when nothing could be added', async () => {
    h.chunks = five()
    const err = new PlatformBudgetExhaustedError(7, 'embedding', 'plan')
    h.embedText.mockRejectedValue(err)
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload(1024) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(err.userMessage)
    expect(h.embedText).toHaveBeenCalledTimes(1)
  })

  it('other per-chunk errors are still skipped and the upload carries on', async () => {
    h.chunks = five()
    h.embedText.mockRejectedValueOnce(new Error('transient')).mockResolvedValue([0.1])
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(upload(1024) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.created).toBe(4)
    expect(body.error).toBeUndefined()
  })
})
