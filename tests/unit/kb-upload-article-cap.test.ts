import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The 2000-article ceiling moved to lib/kb/limits so file upload and
 * review-queue approval agree on "full". Pin the value and prove the upload
 * route still refuses at the shared constant.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  countArticles: vi.fn(),
  createArticleFromSource: vi.fn(),
  createKBSource: vi.fn(),
  parseFile: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/kb', () => ({ countArticles: h.countArticles }))
vi.mock('@/lib/db/queries/kb-article-cap', () => ({ createArticleFromSourceWithinCap: h.createArticleFromSource }))
vi.mock('@/lib/db/queries/kb-sources', () => ({ createKBSource: h.createKBSource, updateKBSourceChunkCount: vi.fn(), deleteKBSource: vi.fn() }))
vi.mock('@/lib/ingest/file-parsers', () => ({
  detectFileType: () => 'txt',
  parseFile: h.parseFile,
  normalizeFileName: (n: string) => n,
  MAX_EXTRACTED_TEXT_BYTES: 2 * 1024 * 1024,
  FileParseError: class FileParseError extends Error {},
}))
vi.mock('@/lib/ingest/url', () => ({ chunkMarkdown: vi.fn(() => []) }))
vi.mock('@/lib/ai/embed', () => ({
  embedText: vi.fn(),
  assertEmbeddingAvailable: vi.fn(async () => {}),
  EMBEDDING_MODEL: 'fake-embed',
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: async () => ({ ok: true }) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

function uploadRequest() {
  const form = new FormData()
  form.set('file', new File(['hello'], 'notes.txt', { type: 'text/plain' }))
  return new Request('https://app.test/api/kb/upload', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5 })
})

describe('lib/kb/limits', () => {
  it('keeps the per-org article ceiling at 2000', async () => {
    const { MAX_ARTICLES_PER_ORG } = await import('@/lib/kb/limits')
    expect(MAX_ARTICLES_PER_ORG).toBe(2000)
  })

  it('is the only definition: the upload route and the review query module do not redeclare it', () => {
    const upload = fs.readFileSync(path.join(process.cwd(), 'app/api/kb/upload/route.ts'), 'utf-8')
    expect(upload).toContain("from '@/lib/kb/limits'")
    expect(upload).not.toMatch(/const\s+MAX_ARTICLES_PER_ORG\s*=/)
  })
})

describe('POST /api/kb/upload article ceiling', () => {
  it('refuses with 400 at the shared limit and parses nothing', async () => {
    const { MAX_ARTICLES_PER_ORG } = await import('@/lib/kb/limits')
    h.countArticles.mockResolvedValue(MAX_ARTICLES_PER_ORG)
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(uploadRequest() as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain(String(MAX_ARTICLES_PER_ORG))
    expect(h.countArticles).toHaveBeenCalledWith(5)
    expect(h.parseFile).not.toHaveBeenCalled()
    expect(h.createKBSource).not.toHaveBeenCalled()
  })

  it('does not trip the ceiling one article below it', async () => {
    const { MAX_ARTICLES_PER_ORG } = await import('@/lib/kb/limits')
    h.countArticles.mockResolvedValue(MAX_ARTICLES_PER_ORG - 1)
    h.parseFile.mockResolvedValue('')
    const { POST } = await import('@/app/api/kb/upload/route')
    const res = await POST(uploadRequest() as never)
    expect(h.parseFile).toHaveBeenCalled()
    expect((await res.json()).error ?? '').not.toContain('full')
  })
})
