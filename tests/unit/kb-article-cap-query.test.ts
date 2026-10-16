import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  order: [] as string[],
  count: 0,
  inserted: [] as unknown[],
}))

function makeTx() {
  return {
    execute: vi.fn(async () => {
      h.order.push('lock')
    }),
    select: vi.fn(() => ({
      from: () => ({
        where: async () => {
          h.order.push('count')
          return [{ n: h.count }]
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: (v: unknown) => ({
        returning: async () => {
          h.order.push('insert')
          h.inserted.push(v)
          return [{ id: 42 }]
        },
      }),
    })),
  }
}

vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({ transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()) }),
}))

import { createArticleFromSourceWithinCap } from '@/lib/db/queries/kb-article-cap'

const input = { question: 'q', answer: 'a', embedding: [0.1, 0.2], model: 'm', sourceId: 5 }

beforeEach(() => {
  h.order.length = 0
  h.inserted.length = 0
  h.count = 0
})

describe('createArticleFromSourceWithinCap', () => {
  it('takes the org lock, then counts, then inserts, in that order', async () => {
    h.count = 10
    await expect(createArticleFromSourceWithinCap(input, 3, 2000)).resolves.toEqual({ id: 42 })
    expect(h.order).toEqual(['lock', 'count', 'insert'])
    expect(h.inserted[0]).toMatchObject({ orgId: 3, sourceId: 5, question: 'q', model: 'm' })
  })

  it('inserts when exactly one slot is left', async () => {
    h.count = 1999
    await expect(createArticleFromSourceWithinCap(input, 3, 2000)).resolves.toEqual({ id: 42 })
  })

  it('writes nothing and returns null at the cap', async () => {
    h.count = 2000
    await expect(createArticleFromSourceWithinCap(input, 3, 2000)).resolves.toBeNull()
    expect(h.order).toEqual(['lock', 'count'])
    expect(h.inserted).toHaveLength(0)
  })

  it('writes nothing and returns null above the cap', async () => {
    h.count = 2500
    await expect(createArticleFromSourceWithinCap(input, 3, 2000)).resolves.toBeNull()
    expect(h.inserted).toHaveLength(0)
  })
})
