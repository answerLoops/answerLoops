import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Behavioural coverage for app/api/kb/search/route.ts — Known Issue 125.
 *
 * Every sibling KB route (kb/upload, kb/sources, kb/articles/[id]) 401s when
 * there's no session rather than defaulting to DEFAULT_ORG_ID. This route
 * didn't, which meant an unauthenticated caller got live vector search
 * results — and triggered a billed embedText call — against the default
 * org's knowledge base, with nothing but request shape standing in the way.
 *
 * Now resolves the org via requireOrgAccess() (Known Issue 124), which
 * re-verifies a real membership row rather than trusting the session claim
 * alone — mocked directly here rather than @/auth underneath it.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  embedText: vi.fn(),
  searchArticles: vi.fn(),
  textSearchArticles: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/ai/embed', () => ({ embedText: h.embedText }))
vi.mock('@/lib/db/queries/kb', () => ({
  searchArticles: h.searchArticles,
  textSearchArticles: h.textSearchArticles,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: h.rateLimit }))

function req(q = 'how do I configure this') {
  return new Request(`https://app.test/api/kb/search?q=${encodeURIComponent(q)}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.rateLimit.mockReturnValue({ ok: true })
  h.embedText.mockResolvedValue([0.1, 0.2])
  h.searchArticles.mockResolvedValue([{ id: 1, question: 'q', answer: 'a' }])
})

describe('app/api/kb/search/route.ts: GET', () => {
  it('returns 401 for an unauthenticated caller, like every sibling KB route', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const { GET } = await import('@/app/api/kb/search/route')
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(h.embedText).not.toHaveBeenCalled()
    expect(h.searchArticles).not.toHaveBeenCalled()
  })

  it('does not fall back to DEFAULT_ORG_ID when there is no real membership', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const { GET } = await import('@/app/api/kb/search/route')
    await GET(req())
    expect(h.embedText).not.toHaveBeenCalled()
  })

  it('searches the caller\'s own org when authenticated', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 42, userId: 1, role: 'member' })
    const { GET } = await import('@/app/api/kb/search/route')
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.embedText).toHaveBeenCalledWith(expect.any(String), 42)
    expect(h.searchArticles).toHaveBeenCalledWith(expect.anything(), 10, 42)
  })

  it('rate-limits per org before doing any billed work', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 42, userId: 1, role: 'member' })
    h.rateLimit.mockReturnValue({ ok: false, retryAfterMs: 1000 })
    const { GET } = await import('@/app/api/kb/search/route')
    const res = await GET(req())
    expect(res.status).toBe(429)
    expect(h.embedText).not.toHaveBeenCalled()
  })

  it('still returns [] for a blank query once authenticated', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 42, userId: 1, role: 'member' })
    const { GET } = await import('@/app/api/kb/search/route')
    const res = await GET(req(''))
    expect(await res.json()).toEqual([])
  })
})
