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

import { ArticleCapReachedError, assertWithinArticleCap, createArticleFromSourceWithinCap } from '@/lib/db/queries/kb-article-cap'

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

describe('assertWithinArticleCap', () => {
  it('takes the org lock before counting and writes nothing', async () => {
    h.count = 5
    await expect(assertWithinArticleCap(makeTx() as never, 3, 2000)).resolves.toBeUndefined()
    expect(h.order).toEqual(['lock', 'count'])
    expect(h.inserted).toHaveLength(0)
  })

  it('allows the last free slot', async () => {
    h.count = 1999
    await expect(assertWithinArticleCap(makeTx() as never, 3, 2000)).resolves.toBeUndefined()
  })

  it.each([2000, 2001])('throws ArticleCapReachedError when the org holds %i articles', async (n) => {
    h.count = n
    await expect(assertWithinArticleCap(makeTx() as never, 3, 2000)).rejects.toBeInstanceOf(ArticleCapReachedError)
  })

  it('uses the cap it is given, not a fixed number', async () => {
    h.count = 3
    await expect(assertWithinArticleCap(makeTx() as never, 3, 3)).rejects.toBeInstanceOf(ArticleCapReachedError)
    await expect(assertWithinArticleCap(makeTx() as never, 3, 4)).resolves.toBeUndefined()
  })

  it('names the error so callers can recognise it', () => {
    const err = new ArticleCapReachedError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ArticleCapReachedError')
  })
})

describe('createArticleFromSourceWithinCap error handling', () => {
  it('passes an unrelated failure from the count through instead of returning null', async () => {
    const boom = new Error('connection lost')
    vi.resetModules()
    vi.doMock('@/lib/db/drizzle', () => ({
      getDb: () => ({
        transaction: async (fn: (tx: unknown) => unknown) =>
          fn({ execute: async () => { throw boom } }),
      }),
    }))
    const { createArticleFromSourceWithinCap: create } = await import('@/lib/db/queries/kb-article-cap')
    await expect(create(input, 3, 2000)).rejects.toBe(boom)
    vi.doUnmock('@/lib/db/drizzle')
  })
})
