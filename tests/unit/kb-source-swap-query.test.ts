import { describe, it, expect, beforeEach, vi } from 'vitest'

// Runs the real swapKBSource builder through drizzle's pg-proxy driver (no live
// Postgres) and checks which statements it emits.

type Call = { sql: string; params: unknown[] }
const { calls, responses } = vi.hoisted(() => ({
  calls: [] as Call[],
  responses: [] as Array<Array<Record<string, unknown>>>,
}))

vi.mock('@/lib/db/drizzle', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  const db = drizzle(async (sqlText: string, params: unknown[]) => {
    calls.push({ sql: sqlText, params })
    return { rows: responses.shift() ?? [] }
  })
  // The proxy driver has no transaction support; run the callback against the
  // same recording client so the emitted statements are still observable.
  const wrapped = Object.assign(Object.create(db), {
    transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  })
  return { getDb: () => wrapped }
})

beforeEach(() => {
  calls.length = 0
  responses.length = 0
})

const input = { orgId: 3, newSourceId: 200, targetFilename: 'acme/docs', published: 1 as const }

describe('swapKBSource', () => {
  it('leaves the existing source in place when the replacement no longer exists', async () => {
    const { swapKBSource } = await import('@/lib/db/queries/kb-sources')
    responses.push([]) // replacement lookup finds nothing

    await expect(swapKBSource(input)).rejects.toThrow(/left in place/)

    const statements = calls.map((c) => c.sql.toLowerCase())
    expect(statements.some((s) => s.startsWith('delete from'))).toBe(false)
    expect(statements.some((s) => s.startsWith('update'))).toBe(false)
  })

  it('locks the replacement, then retires the old source without touching the replacement', async () => {
    const { swapKBSource } = await import('@/lib/db/queries/kb-sources')
    responses.push([{ id: 200 }])

    await swapKBSource(input)

    const lookup = calls.find((c) => c.sql.toLowerCase().startsWith('select'))
    expect(lookup?.sql.toLowerCase()).toContain('for update')

    const del = calls.find((c) => c.sql.toLowerCase().startsWith('delete from'))
    expect(del).toBeDefined()
    expect(del!.sql).toMatch(/"id"\s*<>\s*\$/)
    expect(del!.params).toContain(200)
    expect(del!.params).toContain('acme/docs')

    const order = calls.map((c) => c.sql.toLowerCase().split(' ')[0])
    expect(order.indexOf('select')).toBeLessThan(order.indexOf('delete'))
    expect(order.filter((s) => s === 'update')).toHaveLength(2)
  })
})
