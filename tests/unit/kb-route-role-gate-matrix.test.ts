import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Table-driven role check for every knowledge-base route that is limited to
// owners and admins. The access helper is replaced with one that applies the
// real rule (the caller's role must be in the allowed list), so a route that
// stops passing its role list lets a member through and the matrix fails.

type Role = 'owner' | 'admin' | 'member' | null

const h = vi.hoisted(() => ({
  role: 'member' as Role,
  sideEffects: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({
  requireOrgAccess: vi.fn(async (roles?: string[]) => {
    if (!h.role) return { ok: false, error: 'Unauthorized' }
    if (roles && !roles.includes(h.role)) return { ok: false, error: 'You do not have permission to do that.' }
    return { ok: true, orgId: 7, userId: 3, role: h.role }
  }),
}))
// Anything a route reaches after the gate records a side effect.
vi.mock('@/lib/db/queries/kb', () => ({ deleteArticle: h.sideEffects, countArticles: h.sideEffects }))
vi.mock('@/lib/db/queries/kb-sources', () => ({
  createKBSource: h.sideEffects,
  deleteKBSource: h.sideEffects,
  setKBSourcePublished: h.sideEffects,
  updateKBSourceChunkCount: h.sideEffects,
}))
vi.mock('@/lib/db/queries/kb-review', () => ({
  MAX_PENDING_REVIEW_ITEMS: 500,
  countReviewItems: h.sideEffects,
  listReviewItems: h.sideEffects,
  approveReviewItem: h.sideEffects,
  rejectReviewItem: h.sideEffects,
  reopenReviewItem: h.sideEffects,
}))
vi.mock('@/lib/db/queries/github', () => ({ getRepoById: h.sideEffects }))
vi.mock('@/lib/db/queries/kb-sync-jobs', () => ({ enqueueKbSyncJob: h.sideEffects }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.sideEffects }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/ai/embed', () => ({ embedTextWithModel: h.sideEffects, assertEmbeddingAvailable: h.sideEffects }))
vi.mock('@/lib/db/queries/kb-article-cap', () => ({ createArticleFromSourceWithinCap: h.sideEffects }))
vi.mock('@/lib/ingest/url', () => ({ chunkMarkdown: () => [] }))
vi.mock('@/lib/ingest/file-parsers', () => ({
  detectFileType: () => 'txt',
  parseFile: async () => '',
  normalizeFileName: (n: string) => n,
  MAX_EXTRACTED_TEXT_BYTES: 1024,
  FileParseError: class FileParseError extends Error {},
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const ctx = (id = '5') => ({ params: Promise.resolve({ id }) })
const url = 'https://app.test/api/x'
const json = (method: string, body: unknown = {}) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

interface Case { name: string; call: () => Promise<Response> }

const cases: Case[] = [
  { name: 'GET /api/kb/review', call: async () => (await import('@/app/api/kb/review/route')).GET(new NextRequest(url)) },
  { name: 'PATCH /api/kb/review/[id]', call: async () => (await import('@/app/api/kb/review/[id]/route')).PATCH(json('PATCH', { action: 'reject' }), ctx()) },
  { name: 'DELETE /api/kb/articles/[id]', call: async () => (await import('@/app/api/kb/articles/[id]/route')).DELETE(json('DELETE'), ctx()) },
  { name: 'DELETE /api/kb/sources/[id]', call: async () => (await import('@/app/api/kb/sources/[id]/route')).DELETE(json('DELETE'), ctx()) },
  { name: 'PATCH /api/kb/sources/[id]', call: async () => (await import('@/app/api/kb/sources/[id]/route')).PATCH(json('PATCH', { published: 0 }), ctx()) },
  { name: 'POST /api/github/sync-kb', call: async () => (await import('@/app/api/github/sync-kb/route')).POST(json('POST', { repo_id: 1 }) as never) },
  {
    name: 'POST /api/kb/upload',
    call: async () => {
      const fd = new FormData()
      fd.append('file', new File(['hello'], 'a.txt', { type: 'text/plain' }))
      return (await import('@/app/api/kb/upload/route')).POST(new NextRequest(url, { method: 'POST', body: fd }))
    },
  },
]

describe('owner/admin-only knowledge-base routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.role = 'member'
  })

  for (const c of cases) {
    describe(c.name, () => {
      it('answers 401 to an unauthenticated caller and does nothing', async () => {
        h.role = null
        const res = await c.call()
        expect(res.status).toBe(401)
        expect(h.sideEffects).not.toHaveBeenCalled()
      })

      it('answers 403 to a member and does nothing', async () => {
        h.role = 'member'
        const res = await c.call()
        expect(res.status).toBe(403)
        expect(h.sideEffects).not.toHaveBeenCalled()
      })

      for (const role of ['admin', 'owner'] as const) {
        it(`lets an ${role} past the gate`, async () => {
          h.role = role
          const res = await c.call()
          expect([401, 403]).not.toContain(res.status)
        })
      }
    })
  }
})
