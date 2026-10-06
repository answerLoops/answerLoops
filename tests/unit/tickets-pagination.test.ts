import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Known Issue 128 — dashboard ticket surfaces (GET /api/tickets and the
 * app/(dashboard)/tickets page) used to call getTickets with no limit at
 * all, returning the org's entire ticket history on every load. Bounded with
 * the same keyset-cursor pattern the Agent API's get_tickets already used.
 */

const { getTicketsMock } = vi.hoisted(() => ({ getTicketsMock: vi.fn() }))
const { requireOrgAccessMock } = vi.hoisted(() => ({ requireOrgAccessMock: vi.fn() }))

vi.mock('@/lib/db/queries/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/queries/tickets')>()
  return { ...actual, getTickets: getTicketsMock }
})
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: requireOrgAccessMock }))

function req(query = '') {
  return new Request(`https://app.test/api/tickets${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  requireOrgAccessMock.mockResolvedValue({ ok: true, orgId: 7, userId: 1, role: 'member' })
  getTicketsMock.mockResolvedValue([])
})

describe('GET /api/tickets: bounded query', () => {
  it('defaults to a bounded limit when none is given', async () => {
    const { GET } = await import('@/app/api/tickets/route')
    await GET(req())
    expect(getTicketsMock).toHaveBeenCalledWith(expect.anything(), 7, 100, undefined)
  })

  it('honors a caller-supplied limit, clamped to the max', async () => {
    const { GET } = await import('@/app/api/tickets/route')
    await GET(req('?limit=50'))
    expect(getTicketsMock).toHaveBeenCalledWith(expect.anything(), 7, 50, undefined)

    await GET(req('?limit=99999'))
    expect(getTicketsMock).toHaveBeenLastCalledWith(expect.anything(), 7, 200, undefined)
  })

  it('falls back to the default for a non-numeric or non-positive limit', async () => {
    const { GET } = await import('@/app/api/tickets/route')
    await GET(req('?limit=0'))
    expect(getTicketsMock).toHaveBeenLastCalledWith(expect.anything(), 7, 100, undefined)

    await GET(req('?limit=notanumber'))
    expect(getTicketsMock).toHaveBeenLastCalledWith(expect.anything(), 7, 100, undefined)
  })

  it('rejects a malformed cursor with 400 instead of passing garbage to the query', async () => {
    const { GET } = await import('@/app/api/tickets/route')
    const res = await GET(req('?cursor=not-valid-base64url!!'))
    expect(res.status).toBe(400)
    expect(getTicketsMock).not.toHaveBeenCalled()
  })

  it('decodes and forwards a valid cursor', async () => {
    const { encodeTicketCursor } = await import('@/lib/db/queries/tickets')
    const cursor = encodeTicketCursor({ createdAt: '2026-01-01T00:00:00Z', id: 42 })
    const { GET } = await import('@/app/api/tickets/route')
    await GET(req(`?cursor=${cursor}`))
    expect(getTicketsMock).toHaveBeenCalledWith(expect.anything(), 7, 100, { createdAt: '2026-01-01T00:00:00Z', id: 42 })
  })
})
