import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Behavioral coverage for lib/agent/http.ts's RateLimit-* headers and
// app/api/v1/agent/tickets/route.ts's Idempotency-Key header — both added to
// close gaps an external API-quality scanner flagged (no rate-limit headers
// on ordinary responses, no header-based idempotency, only the body field).

const VALID_KEY = `al_live_${'a'.repeat(64)}`

const h = vi.hoisted(() => ({
  resolveApiKey: vi.fn(),
  rateLimitShared: vi.fn(),
  orgRateLimitPerMinute: vi.fn(async () => 60),
  createTicketCore: vi.fn(),
}))

vi.mock('@/lib/db/queries/api-keys', () => ({ resolveApiKey: h.resolveApiKey }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgRateLimitPerMinute: h.orgRateLimitPerMinute }))
vi.mock('@/lib/agent/core', () => ({
  createTicketCore: h.createTicketCore,
  getTicketsCore: vi.fn(),
}))

const { authenticateAgentRequest } = await import('@/lib/agent/http')
const { POST: createTicketPost } = await import('@/app/api/v1/agent/tickets/route')

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://answerloops.com${path}`, init)
}

beforeEach(() => {
  h.resolveApiKey.mockReset()
  h.rateLimitShared.mockReset()
  h.createTicketCore.mockReset()
  h.orgRateLimitPerMinute.mockClear()
  h.resolveApiKey.mockResolvedValue({ orgId: 1, keyId: 9, scopes: ['tickets:read', 'tickets:write'] })
})

describe('authenticateAgentRequest: RateLimit-* headers', () => {
  it('on success, returns headers computed from the org limiter\'s count/resetAt against the plan-scoped max', async () => {
    const resetAt = new Date(Date.now() + 25_000)
    h.rateLimitShared
      .mockResolvedValueOnce({ ok: true, retryAfterMs: 0, count: 1, resetAt: new Date(Date.now() + 60_000) }) // IP bucket
      .mockResolvedValueOnce({ ok: true, retryAfterMs: 0, count: 12, resetAt }) // org bucket

    const result = await authenticateAgentRequest(req('/api/v1/agent/tickets', { headers: { authorization: `Bearer ${VALID_KEY}` } }))
    expect('response' in result).toBe(false)
    if ('response' in result) return

    expect(result.rateLimitHeaders['RateLimit-Limit']).toBe('60')
    expect(result.rateLimitHeaders['RateLimit-Remaining']).toBe('48') // 60 - 12
    const reset = Number(result.rateLimitHeaders['RateLimit-Reset'])
    expect(reset).toBeGreaterThan(20)
    expect(reset).toBeLessThanOrEqual(25)
  })

  it('on a 429 (org bucket exhausted), the response carries Retry-After AND RateLimit-Remaining: 0 — not just one or the other', async () => {
    const resetAt = new Date(Date.now() + 10_000)
    h.rateLimitShared
      .mockResolvedValueOnce({ ok: true, retryAfterMs: 0, count: 1, resetAt: new Date(Date.now() + 60_000) }) // IP bucket
      .mockResolvedValueOnce({ ok: false, retryAfterMs: 10_000, count: 61, resetAt }) // org bucket exhausted

    const result = await authenticateAgentRequest(req('/api/v1/agent/tickets', { headers: { authorization: `Bearer ${VALID_KEY}` } }))
    expect('response' in result).toBe(true)
    if (!('response' in result)) return

    expect(result.response.status).toBe(429)
    expect(result.response.headers.get('Retry-After')).toBe('10')
    expect(result.response.headers.get('RateLimit-Limit')).toBe('60')
    expect(result.response.headers.get('RateLimit-Remaining')).toBe('0')
    const body = await result.response.json()
    expect(body.error.code).toBe('rate_limited')
  })
})

describe('POST /api/v1/agent/tickets: Idempotency-Key header', () => {
  it('a header-supplied Idempotency-Key reaches createTicketCore as args.idempotencyKey', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0, count: 1, resetAt: new Date(Date.now() + 60_000) })
    h.createTicketCore.mockResolvedValue({ ok: true, data: { ticket_id: 1, duplicate: false } })

    await createTicketPost(
      req('/api/v1/agent/tickets', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${VALID_KEY}`,
          'content-type': 'application/json',
          'idempotency-key': 'header-key-123',
        },
        body: JSON.stringify({ content: 'help, my webhook stopped firing' }),
      })
    )

    expect(h.createTicketCore).toHaveBeenCalledTimes(1)
    const [, args] = h.createTicketCore.mock.calls[0]
    expect(args.idempotencyKey).toBe('header-key-123')
  })

  it('the header wins when the body also sends idempotencyKey', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0, count: 1, resetAt: new Date(Date.now() + 60_000) })
    h.createTicketCore.mockResolvedValue({ ok: true, data: { ticket_id: 1, duplicate: false } })

    await createTicketPost(
      req('/api/v1/agent/tickets', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${VALID_KEY}`,
          'content-type': 'application/json',
          'idempotency-key': 'from-header',
        },
        body: JSON.stringify({ content: 'help', idempotencyKey: 'from-body' }),
      })
    )

    const [, args] = h.createTicketCore.mock.calls[0]
    expect(args.idempotencyKey).toBe('from-header')
  })

  it('without the header, the body field is used unchanged', async () => {
    h.rateLimitShared.mockResolvedValue({ ok: true, retryAfterMs: 0, count: 1, resetAt: new Date(Date.now() + 60_000) })
    h.createTicketCore.mockResolvedValue({ ok: true, data: { ticket_id: 1, duplicate: false } })

    await createTicketPost(
      req('/api/v1/agent/tickets', {
        method: 'POST',
        headers: { authorization: `Bearer ${VALID_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'help', idempotencyKey: 'from-body' }),
      })
    )

    const [, args] = h.createTicketCore.mock.calls[0]
    expect(args.idempotencyKey).toBe('from-body')
  })

  it('the successful response still carries the RateLimit-* headers', async () => {
    h.rateLimitShared
      .mockResolvedValueOnce({ ok: true, retryAfterMs: 0, count: 1, resetAt: new Date(Date.now() + 60_000) })
      .mockResolvedValueOnce({ ok: true, retryAfterMs: 0, count: 5, resetAt: new Date(Date.now() + 60_000) })
    h.createTicketCore.mockResolvedValue({ ok: true, data: { ticket_id: 1, duplicate: false } })

    const res = await createTicketPost(
      req('/api/v1/agent/tickets', {
        method: 'POST',
        headers: { authorization: `Bearer ${VALID_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'help' }),
      })
    )

    expect(res.status).toBe(201)
    expect(res.headers.get('RateLimit-Limit')).toBe('60')
    expect(res.headers.get('RateLimit-Remaining')).toBe('55')
  })
})
