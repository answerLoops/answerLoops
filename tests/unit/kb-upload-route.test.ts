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
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/ai/embed', () => ({
  embedTextWithModel: async (text: string, orgId?: number) => ({ embedding: await h.embedText(text, orgId), model: 'm' }),
  assertEmbeddingAvailable: h.assertEmbeddingAvailable,
}))
vi.mock('@/lib/db/queries/kb', () => ({ countArticles: h.countArticles, createArticleFromSource: h.createArticleFromSource }))
vi.mock('@/lib/db/queries/kb-sources', () => ({ createKBSource: h.createKBSource, updateKBSourceChunkCount: h.updateKBSourceChunkCount }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/ingest/url', () => ({
  chunkMarkdown: () => [{ question: 'q', answer: 'a'.repeat(100) }],
}))
vi.mock('@/lib/ingest/file-parsers', () => ({
  detectFileType: (n: string) => (n.endsWith('.txt') ? 'txt' : null),
  parseFile: async () => 'some text',
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
  h.embedText.mockResolvedValue([0.1])
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
