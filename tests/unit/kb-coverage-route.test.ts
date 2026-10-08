import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * app/api/kb/coverage/route.ts — what the chat assistant can answer from.
 * Like every sibling KB route it 401s without a real membership and reads only
 * the caller's org; the query itself scopes both tables by org.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  getKnowledgeCoverage: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/kb-coverage', () => ({ getKnowledgeCoverage: h.getKnowledgeCoverage }))

const req = () => new Request('https://app.test/api/kb/coverage')

beforeEach(() => {
  vi.clearAllMocks()
  h.getKnowledgeCoverage.mockResolvedValue({
    summary: { total: 0, live: 0, unpublished: 0, notSearchable: 0, sources: 0 },
    groups: [],
    truncated: false,
  })
})

describe('GET /api/kb/coverage', () => {
  it('returns 401 and reads nothing for a caller without org access', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const { GET } = await import('@/app/api/kb/coverage/route')
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(h.getKnowledgeCoverage).not.toHaveBeenCalled()
  })

  it("reads coverage for the caller's own org only", async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
    const { GET } = await import('@/app/api/kb/coverage/route')
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.getKnowledgeCoverage).toHaveBeenCalledExactlyOnceWith(7)
    expect((await res.json()).summary.total).toBe(0)
  })

  it('answers 500 with a generic message when the read fails', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
    h.getKnowledgeCoverage.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/kb/coverage/route')
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('db down')
  })
})

describe('structural guarantees (source-level, same convention as the other tenant tests)', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8')

  it('scopes the article query and the source join by org', () => {
    const src = read('lib/db/queries/kb-coverage.ts')
    expect(src).toContain('eq(kbArticles.orgId, orgId)')
    expect(src).toContain('eq(kbSources.orgId, orgId)')
  })

  it('treats "live" as published and embedded, matching retrieval', () => {
    expect(read('lib/db/queries/kb-coverage.ts')).toContain('embeddingVec} IS NOT NULL')
    const retrieval = read('lib/db/queries/kb.ts')
    expect(retrieval).toContain('eq(kbArticles.published, 1)')
    expect(retrieval).toContain('isNotNull(kbArticles.embeddingVec)')
  })

  it('links the tab from the Chat widget settings and exposes it on the KB page', () => {
    expect(read('app/(dashboard)/settings/page.tsx')).toContain('/kb?tab=coverage')
    const kb = read('app/(dashboard)/kb/page.tsx')
    expect(kb).toContain("id: 'coverage'")
    expect(kb).toContain('<CoverageTab />')
  })

  it("keeps the tester's match count in step with what the widget retrieves", () => {
    const widget = read('app/api/widget/chat/route.ts')
    const tab = read('app/(dashboard)/kb/coverage-tab.tsx')
    const n = widget.match(/const MAX_CONTEXT_ARTICLES = (\d+)/)?.[1]
    expect(n).toBeTruthy()
    expect(tab).toContain(`const WIDGET_CONTEXT_ARTICLES = ${n}`)
  })
})
