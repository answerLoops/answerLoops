import { describe, it, expect, vi, beforeEach } from 'vitest'

// getTicketsCore's cursor pagination (lib/agent/core.ts) — behavioral tests
// against a mocked lib/db/queries/tickets.getTickets, since the encode/decode
// and hasMore/next_cursor logic live in core.ts, not in the query layer
// covered by mcp-server.test.ts's source-text checks.

type FakeTicket = {
  id: number
  content: string
  category: string | null
  priority: string
  status: string
  ai_summary: string | null
  created_at: string
}

const { getTicketsMock } = vi.hoisted(() => ({ getTicketsMock: vi.fn() }))

vi.mock('@/lib/db/queries/tickets', () => ({ getTickets: getTicketsMock }))

const { getTicketsCore } = await import('@/lib/agent/core')

function ticket(id: number, createdAt: string): FakeTicket {
  return { id, content: `t${id}`, category: null, priority: 'medium', status: 'open', ai_summary: null, created_at: createdAt }
}

beforeEach(() => {
  getTicketsMock.mockReset()
})

describe('getTicketsCore pagination', () => {
  it('requests limit + 1 rows so it can tell whether another page follows, and trims back to limit', async () => {
    // 3 rows returned for a page size of 2 — one extra proves there's a next page.
    getTicketsMock.mockResolvedValue([ticket(3, '2026-09-01T00:00:03Z'), ticket(2, '2026-09-01T00:00:02Z'), ticket(1, '2026-09-01T00:00:01Z')])

    const result = await getTicketsCore(1, { limit: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(getTicketsMock).toHaveBeenCalledWith({ status: undefined, priority: undefined, category: undefined }, 1, 3, undefined)
    expect(result.data.tickets).toHaveLength(2)
    expect(result.data.tickets.map((t) => t.id)).toEqual([3, 2])
    expect(result.data.next_cursor).not.toBeNull()
  })

  it('returns next_cursor: null when the fetched rows fit within the page (no next page)', async () => {
    getTicketsMock.mockResolvedValue([ticket(2, '2026-09-01T00:00:02Z'), ticket(1, '2026-09-01T00:00:01Z')])

    const result = await getTicketsCore(1, { limit: 5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.tickets).toHaveLength(2)
    expect(result.data.next_cursor).toBeNull()
  })

  it('a returned next_cursor round-trips: decoding it and feeding it back as `cursor` reaches getTickets with the last row\'s (created_at, id)', async () => {
    getTicketsMock.mockResolvedValue([ticket(3, '2026-09-01T00:00:03Z'), ticket(2, '2026-09-01T00:00:02Z'), ticket(1, '2026-09-01T00:00:01Z')])
    const first = await getTicketsCore(1, { limit: 2 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const cursor = first.data.next_cursor
    expect(cursor).toBeTruthy()

    getTicketsMock.mockResolvedValue([ticket(1, '2026-09-01T00:00:01Z')])
    await getTicketsCore(1, { limit: 2, cursor })

    const [, , , decodedCursor] = getTicketsMock.mock.calls[1]
    expect(decodedCursor).toEqual({ createdAt: '2026-09-01T00:00:02Z', id: 2 })
  })

  it('rejects a malformed cursor instead of passing garbage into the query', async () => {
    const result = await getTicketsCore(1, { cursor: 'not-valid-base64url-cursor!!' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('cursor')
    expect(getTicketsMock).not.toHaveBeenCalled()
  })

  it('omitting cursor entirely still fetches the first page (cursor passed through as undefined, not treated as invalid)', async () => {
    getTicketsMock.mockResolvedValue([])
    const result = await getTicketsCore(1, {})
    expect(result.ok).toBe(true)
    expect(getTicketsMock).toHaveBeenCalledWith(expect.anything(), 1, expect.any(Number), undefined)
  })
})
