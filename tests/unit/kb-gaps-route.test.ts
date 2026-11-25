import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * app/api/kb/gaps/route.ts — the data behind the Gaps tab on the KB page.
 * Org-scoped like every sibling KB route, and plan gated like the old
 * Knowledge Gaps page it replaces: a workspace without the feature is told
 * which plan unlocks it and never receives the data.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  orgHasFeature: vi.fn(),
  getGapTicketTotals: vi.fn(),
  getKnowledgeGapClusters: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/analytics', () => ({
  getGapTicketTotals: h.getGapTicketTotals,
  getKnowledgeGapClusters: h.getKnowledgeGapClusters,
}))
vi.mock('@/lib/logger', () => ({ logger: { error: h.loggerError } }))
vi.mock('@/lib/request-id', () => ({ getRequestId: () => 'req-test' }))

const req = () => new Request('https://app.test/api/kb/gaps')
const TOTALS = { total: 2, needs_human: 1, low_confidence: 1, no_kb_article: 0, categories: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.getGapTicketTotals.mockResolvedValue(TOTALS)
  h.getKnowledgeGapClusters.mockResolvedValue([])
})

describe('GET /api/kb/gaps', () => {
  it('returns 401 and reads nothing for a caller without org access', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const { GET } = await import('@/app/api/kb/gaps/route')
    expect((await GET(req())).status).toBe(401)
    expect(h.orgHasFeature).not.toHaveBeenCalled()
    expect(h.getGapTicketTotals).not.toHaveBeenCalled()
  })

  it('tells a workspace without the feature which plan unlocks it, and reads no data', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
    h.orgHasFeature.mockResolvedValue(false)
    const { GET } = await import('@/app/api/kb/gaps/route')
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ locked: true, requiredPlan: 'pro' })
    expect(h.getGapTicketTotals).not.toHaveBeenCalled()
    expect(h.getKnowledgeGapClusters).not.toHaveBeenCalled()
  })

  it("reads the gaps for the caller's own org only", async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
    h.orgHasFeature.mockResolvedValue(true)
    const { GET } = await import('@/app/api/kb/gaps/route')
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.orgHasFeature).toHaveBeenCalledExactlyOnceWith(7, 'knowledge_gap_dashboard')
    expect(h.getGapTicketTotals).toHaveBeenCalledExactlyOnceWith(7)
    expect(h.getKnowledgeGapClusters).toHaveBeenCalledExactlyOnceWith(50, 7)
    expect(await res.json()).toEqual({ locked: false, totals: TOTALS, clusters: [] })
  })

  it('returns 500 and logs when a read fails', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
    h.orgHasFeature.mockResolvedValue(true)
    h.getGapTicketTotals.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/kb/gaps/route')
    expect((await GET(req())).status).toBe(500)
    expect(h.loggerError).toHaveBeenCalledTimes(1)
  })
})
