import { describe, it, expect, vi, beforeEach } from 'vitest'

// Flagging saved resolutions near changed documentation, given the ids of the
// sections that changed. Used by the swap of a rebuilt source and by the
// per-file replace of an incremental sync. It never fails the sync.

const h = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/db/drizzle', () => ({ getDb: vi.fn() }))

import { flagResolutionsNearChunks } from '@/lib/db/queries/kb-sources'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

function fakeTx(execute: (q: SQL) => Promise<unknown>) {
  const sp = { execute: vi.fn(execute) }
  const tx = { transaction: vi.fn(async (fn: (s: typeof sp) => Promise<void>) => fn(sp)) }
  return { tx: tx as never, sp }
}

const dialect = new PgDialect()

beforeEach(() => vi.clearAllMocks())

describe('flagResolutionsNearChunks', () => {
  it('issues no SQL for an empty list', async () => {
    const { tx, sp } = fakeTx(async () => [])
    await flagResolutionsNearChunks(tx, { orgId: 7, chunkIds: [], sourceLabel: 'acme/docs', ts: '2026-11-23T00:00:00Z' })
    expect(sp.execute).not.toHaveBeenCalled()
  })

  it('marks resolutions near the given sections with the source label', async () => {
    const { tx, sp } = fakeTx(async () => [])
    expect(await flagResolutionsNearChunks(tx, { orgId: 7, chunkIds: [11, 12], sourceLabel: 'acme/docs', ts: '2026-11-23T00:00:00Z' })).toBe(true)
    expect(sp.execute).toHaveBeenCalledTimes(1)
    const q = dialect.sqlToQuery(sp.execute.mock.calls[0][0] as SQL)
    expect(q.sql).toMatch(/UPDATE kb_articles AS r/)
    expect(q.sql).toMatch(/r\.source_ticket_id IS NOT NULL/)
    expect(q.params).toEqual(expect.arrayContaining([7, 11, 12, 'acme/docs', '2026-11-23T00:00:00Z']))
  })

  it('logs and swallows a failure', async () => {
    const { tx } = fakeTx(async () => { throw new Error('db down') })
    await expect(
      flagResolutionsNearChunks(tx, { orgId: 7, chunkIds: [11], sourceLabel: 'acme/docs', ts: '2026-11-23T00:00:00Z' })
    ).resolves.toBe(false)
    expect(h.warn).toHaveBeenCalled()
  })
})
