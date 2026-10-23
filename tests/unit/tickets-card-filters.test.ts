import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { PgSelectBase } from 'drizzle-orm/pg-core'

// The dashboard stat cards link to /tickets?<filter>=1. getTickets has to apply
// the same definition the card's number uses, or the card says 4 and the list
// shows a different count.

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))

interface Captured {
  sql: string
  params: unknown[]
}

function captureSelects(): Captured[] {
  const captured: Captured[] = []
  vi.spyOn(PgSelectBase.prototype as unknown as { _prepare: () => unknown }, '_prepare').mockImplementation(function (this: unknown) {
    captured.push((this as { toSQL(): Captured }).toSQL())
    return { execute: () => Promise.resolve([]) }
  })
  return captured
}

async function whereFor(filters: Record<string, boolean>) {
  const captured = captureSelects()
  const { getTickets } = await import('@/lib/db/queries/tickets')
  await getTickets(filters, 7)
  // The select list names every column, so only the WHERE clause is meaningful.
  const { sql, params } = captured[0]
  return { sql: sql.slice(sql.indexOf(' where ')), params }
}

beforeEach(() => {
  vi.clearAllMocks()
  getDb.mockReturnValue(drizzle.mock())
})
afterEach(() => vi.restoreAllMocks())

describe('getTickets card filters', () => {
  it('adds no card condition when no card filter is set (control)', async () => {
    const { sql } = await whereFor({})
    expect(sql).not.toContain('ai_assessments')
    expect(sql).not.toContain('sla_response_met')
    expect(sql).not.toContain('ai_draft_status')
  })

  it('autoDeflected keeps tickets with a deflected assessment and drops duplicates', async () => {
    const { sql } = await whereFor({ autoDeflected: true })
    expect(sql).toMatch(/!= 'duplicate'/)
    expect(sql).toMatch(/a\.auto_deflected = 1/)
  })

  it('needsReview keeps open tickets with a non-deflected assessment', async () => {
    const { sql } = await whereFor({ needsReview: true })
    expect(sql).toMatch(/= 'open'/)
    expect(sql).toMatch(/a\.auto_deflected = 0/)
  })

  it('pendingDraft keeps open tickets whose AI draft is pending', async () => {
    const { sql } = await whereFor({ pendingDraft: true })
    expect(sql).toMatch(/"status" = 'open'/)
    expect(sql).toMatch(/"ai_draft_status" = 'pending'/)
  })

  it('slaBreached keeps tickets that missed a response or resolve target, excluding duplicates', async () => {
    const { sql } = await whereFor({ slaBreached: true })
    expect(sql).toContain('"sla_response_met" = 0')
    expect(sql).toContain('"sla_resolve_met" = 0')
    expect(sql).toMatch(/!= 'duplicate'/)
  })

  it('combines every filter with the org scope instead of widening it', async () => {
    const { sql, params } = await whereFor({ needsReview: true, slaBreached: true })
    expect(sql).toContain('"tickets"."org_id" =')
    expect(params).toContain(7)
    expect(sql).toMatch(/a\.auto_deflected = 0/)
    expect(sql).toContain('"sla_resolve_met" = 0')
  })
})

describe('getTicketStats card counts', () => {
  it('counts each card with the same condition its ticket list filters on', async () => {
    const captured = captureSelects()
    const { getTicketStats } = await import('@/lib/db/queries/tickets')
    await getTicketStats(7)

    const wheres = captured.map(({ sql }) => sql.slice(sql.indexOf(' where ')))
    for (const [filter, pattern] of [
      ['autoDeflected', /a\.auto_deflected = 1/],
      ['needsReview', /a\.auto_deflected = 0/],
      ['pendingDraft', /"ai_draft_status" = 'pending'/],
      ['slaBreached', /"sla_response_met" = 0 OR [\s\S]*"sla_resolve_met" = 0/],
    ] as const) {
      const listWhere = (await whereFor({ [filter]: true })).sql
      expect(listWhere).toMatch(pattern)
      expect(wheres.some((w) => pattern.test(w) && w.includes('"tickets"."org_id" ='))).toBe(true)
    }
  })
})
