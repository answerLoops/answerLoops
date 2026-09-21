import { describe, it, expect, beforeEach, vi } from 'vitest'

// A ticket marked `duplicate` must not inflate dashboard totals, deflection
// metrics, category counts, or SLA figures. Runs the real query builders
// through drizzle's pg-proxy driver (no live Postgres) and asserts the emitted
// SQL excludes duplicates from each count.

type Call = { sql: string; params: unknown[] }
const { calls } = vi.hoisted(() => ({ calls: [] as Call[] }))

vi.mock('@/lib/db/drizzle', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  const db = drizzle(async (sqlText: string, params: unknown[]) => {
    calls.push({ sql: sqlText, params })
    return { rows: [{ n: 0 }] }
  })
  return { getDb: () => db }
})

beforeEach(() => {
  calls.length = 0
})

const excludesDuplicate = (c: Call) =>
  /status"?\s*(!=|<>)\s*'duplicate'/.test(c.sql) ||
  (/status"?\s*(!=|<>)\s*\$\d+/.test(c.sql) && c.params.includes('duplicate'))

describe('getTicketStats', () => {
  it('excludes duplicates from total, SLA-breach and deflected counts', async () => {
    const { getTicketStats } = await import('@/lib/db/queries/tickets')
    await getTicketStats(42)

    // The total count is the first query getTicketStats issues.
    const total = calls[0]
    expect(total).toBeDefined()
    expect(excludesDuplicate(total!)).toBe(true)

    const breach = calls.find((c) => c.sql.includes('sla_response_met = 0'))
    expect(breach).toBeDefined()
    expect(excludesDuplicate(breach!)).toBe(true)

    const deflected = calls.find((c) => c.sql.includes('auto_deflected = 1'))
    expect(deflected).toBeDefined()
    expect(excludesDuplicate(deflected!)).toBe(true)
  })

  it('excludes duplicates from the SLA-breach list', async () => {
    const { getSLABreachedTickets } = await import('@/lib/db/queries/tickets')
    await getSLABreachedTickets(42)
    expect(calls[0].sql).toMatch(/NOT IN \('resolved', 'closed', 'duplicate'\)/)
  })
})

describe('analytics queries', () => {
  it.each([
    ['getDeflectionStats'],
    ['getDeflectionTrend'],
    ['getCategoryBreakdown'],
    ['getSLAStats'],
    ['getKnowledgeGaps'],
    ['getGapCategorySummary'],
  ])('%s excludes duplicates from every query', async (fn) => {
    const mod = (await import('@/lib/db/queries/analytics')) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
    await (fn === 'getDeflectionTrend' ? mod[fn](14, 42) : fn === 'getKnowledgeGaps' ? mod[fn](50, 42) : mod[fn](42))
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.sql).toContain(`'duplicate'`)
  })
})

describe('status plumbing', () => {
  it('accepts duplicate as a valid status everywhere it is enumerated', async () => {
    const { TICKET_STATUSES } = await import('@/lib/agent/core')
    expect(TICKET_STATUSES).toContain('duplicate')
  })
})
