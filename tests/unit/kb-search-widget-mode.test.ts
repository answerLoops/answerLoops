import { describe, it, expect, vi, beforeEach } from 'vitest'

// /api/kb/search?for=widget runs the same lookup the website widget does, so
// the Knowledge coverage tester shows what the assistant would draw on. The
// plain search used on the Manage tab is unchanged.

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  rateLimitShared: vi.fn(),
  embedText: vi.fn(),
  searchArticles: vi.fn(),
  widgetLookup: vi.fn(),
  textSearchArticles: vi.fn(),
}))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/ai/embed', () => ({ embedText: h.embedText }))
vi.mock('@/lib/db/queries/kb', () => ({
  searchArticles: h.searchArticles,
  widgetLookup: h.widgetLookup,
  textSearchArticles: h.textSearchArticles,
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { GET } from '@/app/api/kb/search/route'
import { WIDGET_CONTEXT_ARTICLES } from '@/lib/widget/context-size'

const get = (qs: string) => GET(new Request(`http://x/api/kb/search?${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.embedText.mockResolvedValue([0.1])
  h.searchArticles.mockResolvedValue([{ id: 1, question: 'Q', answer: 'A', score: 0.9 }])
  h.widgetLookup.mockResolvedValue({ results: [{ id: 2, question: 'Pricing › Pro', answer: 'A', score: 0.38 }], matched: false })
})

describe('GET /api/kb/search', () => {
  it('runs the widget lookup for the coverage tester', async () => {
    const res = await get('q=what%20does%20it%20cost&for=widget')
    expect(await res.json()).toEqual({ results: [{ id: 2, question: 'Pricing › Pro', answer: 'A', score: 0.38 }], matched: false, degraded: false })
    expect(h.widgetLookup).toHaveBeenCalledWith([0.1], WIDGET_CONTEXT_ARTICLES, 7)
    expect(h.searchArticles).not.toHaveBeenCalled()
  })

  it('keeps the plain search for everything else', async () => {
    const res = await get('q=reset')
    expect(await res.json()).toEqual({ results: [{ id: 1, question: 'Q', answer: 'A', score: 0.9 }], degraded: false })
    expect(h.searchArticles).toHaveBeenCalledWith([0.1], 10, 7)
    expect(h.widgetLookup).not.toHaveBeenCalled()
  })
})
