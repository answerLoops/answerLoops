import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { PgInsertBase, PgDeleteBase } from 'drizzle-orm/pg-core'

// The Stripe event id is claimed with a single INSERT .. ON CONFLICT DO
// NOTHING RETURNING, so of two simultaneous deliveries exactly one handles it.

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))

interface Captured {
  sql: string
  params: unknown[]
}

function intercept(proto: object, result: unknown[], into: Captured[]) {
  vi.spyOn(proto as unknown as { _prepare: () => unknown }, '_prepare').mockImplementation(function (this: unknown) {
    into.push((this as { toSQL(): Captured }).toSQL())
    return { execute: () => Promise.resolve(result) }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getDb.mockReturnValue(drizzle.mock())
})
afterEach(() => vi.restoreAllMocks())

describe('claimWebhookEvent', () => {
  it('is one INSERT .. ON CONFLICT DO NOTHING RETURNING', async () => {
    const captured: Captured[] = []
    intercept(PgInsertBase.prototype, [{ eventId: 'evt_1' }], captured)
    const { claimWebhookEvent } = await import('@/lib/db/queries/billing')
    expect(await claimWebhookEvent('evt_1')).toBe(true)
    expect(captured).toHaveLength(1)
    expect(captured[0].sql).toMatch(/insert into "webhook_events"/i)
    expect(captured[0].sql).toMatch(/on conflict do nothing/i)
    expect(captured[0].sql).toMatch(/returning/i)
    expect(captured[0].params).toContain('evt_1')
  })

  it('returns false for the loser of the race (the insert returned no row)', async () => {
    intercept(PgInsertBase.prototype, [], [])
    const { claimWebhookEvent } = await import('@/lib/db/queries/billing')
    expect(await claimWebhookEvent('evt_1')).toBe(false)
  })
})

describe('releaseWebhookEventClaim', () => {
  it('deletes the claim so the retry is processed', async () => {
    const captured: Captured[] = []
    intercept(PgDeleteBase.prototype, [], captured)
    const { releaseWebhookEventClaim } = await import('@/lib/db/queries/billing')
    await releaseWebhookEventClaim('evt_1')
    expect(captured[0].sql).toMatch(/delete from "webhook_events"/i)
    expect(captured[0].params).toContain('evt_1')
  })
})
