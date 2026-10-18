import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

// updateTicketAIDraftStatus records why a ticket went to a person with no
// draft. Verified against drizzle's pg-proxy driver (compiled SQL, no real
// connection): an explicit reason is written, a move off needs_human clears
// it, and a later needs_human write without a reason leaves it alone.

async function compile(run: (update: typeof import('@/lib/db/queries/tickets').updateTicketAIDraftStatus) => Promise<void>) {
  const calls: { sql: string; params: unknown[] }[] = []
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    calls.push({ sql: sqlText, params })
    return { rows: [] }
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
  vi.resetModules()
  const { updateTicketAIDraftStatus } = await import('@/lib/db/queries/tickets')
  await run(updateTicketAIDraftStatus)
  expect(calls).toHaveLength(1)
  return calls[0]
}

describe('updateTicketAIDraftStatus skip reason', () => {
  it('writes the reason when one is given', async () => {
    const call = await compile((update) => update(1, 'needs_human', undefined, 'bug_or_feature'))
    expect(call.sql).toContain('"ai_draft_skip_reason"')
    expect(call.params).toContain('bug_or_feature')
  })

  it('clears the reason when the status moves off needs_human', async () => {
    const call = await compile((update) => update(1, 'approved'))
    expect(call.sql).toContain('"ai_draft_skip_reason"')
    expect(call.params).not.toContain('bug_or_feature')
  })

  it('leaves the stored reason alone when needs_human is written again without one', async () => {
    const call = await compile((update) => update(1, 'needs_human'))
    expect(call.sql).not.toContain('"ai_draft_skip_reason"')
  })
})
