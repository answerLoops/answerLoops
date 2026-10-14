import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { PgSelectBase } from 'drizzle-orm/pg-core'

// A reaction / CSAT / feedback message id resolves to a ticket only inside the
// caller's own org. The real drizzle builder renders the SQL; execution is
// intercepted so the join and the org predicate are what get asserted.

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))
const h = vi.hoisted(() => ({
  getIntegrationByBotSecret: vi.fn(),
  getTicketIdByCsatMessage: vi.fn(),
  saveCsatRating: vi.fn(),
}))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegrationByBotSecret: h.getIntegrationByBotSecret }))
vi.mock('@/lib/ingest/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))


interface Captured {
  sql: string
  params: unknown[]
}

function captureSelects(rows: unknown[]): Captured[] {
  const captured: Captured[] = []
  vi.spyOn(PgSelectBase.prototype as unknown as { _prepare: () => unknown }, '_prepare').mockImplementation(function (this: unknown) {
    captured.push((this as { toSQL(): Captured }).toSQL())
    return { execute: () => Promise.resolve(rows) }
  })
  return captured
}

beforeEach(() => {
  vi.clearAllMocks()
  getDb.mockReturnValue(drizzle.mock())
})
afterEach(() => vi.restoreAllMocks())

describe('getTicketIdByCsatMessage', () => {
  it('joins the ticket and restricts the match to the caller org', async () => {
    const captured = captureSelects([{ ticketId: 12 }])
    const { getTicketIdByCsatMessage } = await import('@/lib/db/queries/csat')
    expect(await getTicketIdByCsatMessage('msg-1', 7)).toBe(12)
    const { sql, params } = captured[0]
    expect(sql).toMatch(/inner join "tickets"/i)
    expect(sql).toContain('"tickets"."org_id" =')
    expect(params).toEqual(expect.arrayContaining(['msg-1', 7]))
  })

  it('returns null when nothing matches inside that org (another org\'s message looks unknown)', async () => {
    captureSelects([])
    const { getTicketIdByCsatMessage } = await import('@/lib/db/queries/csat')
    expect(await getTicketIdByCsatMessage('msg-1', 8)).toBeNull()
  })
})

describe('getTicketIdByAnswerMessage', () => {
  it('joins the ticket and restricts the match to the caller org', async () => {
    const captured = captureSelects([{ ticketId: 33 }])
    const { getTicketIdByAnswerMessage } = await import('@/lib/db/queries/feedback')
    expect(await getTicketIdByAnswerMessage('msg-2', 7)).toBe(33)
    const { sql, params } = captured[0]
    expect(sql).toMatch(/inner join "tickets"/i)
    expect(sql).toContain('"tickets"."org_id" =')
    expect(params).toEqual(expect.arrayContaining(['msg-2', 7]))
  })

  it('returns null for a message that belongs to a different org', async () => {
    captureSelects([])
    const { getTicketIdByAnswerMessage } = await import('@/lib/db/queries/feedback')
    expect(await getTicketIdByAnswerMessage('msg-2', 9)).toBeNull()
  })
})

describe('reaction route passes the authenticated org to the lookup and ignores a mismatch', () => {
  function reactionRequest() {
    return new Request('http://localhost/api/ingest/reaction', {
      method: 'POST',
      headers: { authorization: 'Bearer org-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ message_id: 'm1', emoji: 'five', user_id: 'u1' }),
    })
  }

  it('scopes the CSAT lookup to the org that owns the secret and saves nothing when it finds no ticket there', async () => {
    vi.doMock('@/lib/db/queries/csat', () => ({
      getTicketIdByCsatMessage: h.getTicketIdByCsatMessage,
      saveCsatRating: h.saveCsatRating,
    }))
    vi.resetModules()
    h.getIntegrationByBotSecret.mockResolvedValue({ org_id: 5, platform: 'discord' })
    h.getTicketIdByCsatMessage.mockResolvedValue(null)

    const { POST } = await import('@/app/api/ingest/reaction/route')
    const res = await POST(reactionRequest())

    expect(h.getIntegrationByBotSecret).toHaveBeenCalledWith('org-secret', 'discord')
    expect(h.getTicketIdByCsatMessage).toHaveBeenCalledWith('m1', 5)
    expect(h.saveCsatRating).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ ok: true, ignored: true })
  })

  it('records the rating under the same org when the ticket belongs to it', async () => {
    vi.doMock('@/lib/db/queries/csat', () => ({
      getTicketIdByCsatMessage: h.getTicketIdByCsatMessage,
      saveCsatRating: h.saveCsatRating,
    }))
    vi.resetModules()
    h.getIntegrationByBotSecret.mockResolvedValue({ org_id: 5, platform: 'discord' })
    h.getTicketIdByCsatMessage.mockResolvedValue(77)

    const { POST } = await import('@/app/api/ingest/reaction/route')
    await POST(reactionRequest())

    expect(h.saveCsatRating).toHaveBeenCalledWith({ ticketId: 77, orgId: 5, rating: 5, platform: 'discord' })
  })
})
