import { describe, it, expect, vi, beforeEach } from 'vitest'

// seedProductFeedbackIfEmpty must only insert into an empty table, so a row an
// operator deleted is never resurrected on the next boot.

const { count, values, insert } = vi.hoisted(() => {
  const countFn = vi.fn()
  const valuesFn = vi.fn(async () => {})
  return { count: countFn, values: valuesFn, insert: vi.fn(() => ({ values: valuesFn })) }
})
vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({ select: () => ({ from: async () => count() }), insert }),
}))
// queries file imports '../drizzle' relative; same module id as above.

import { seedProductFeedbackIfEmpty } from '@/lib/db/queries/product-feedback'
import { productFeedback } from '@/lib/db/schema'
import { FEEDBACK_STATUSES, REPLY_TAGS } from '@/lib/product-feedback/validation'

describe('seedProductFeedbackIfEmpty', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts nothing when the table already has rows', async () => {
    count.mockReturnValue([{ n: 3 }])
    await seedProductFeedbackIfEmpty()
    expect(insert).not.toHaveBeenCalled()
  })

  it('inserts one approved, authorless example row into an empty table', async () => {
    count.mockReturnValue([{ n: 0 }])
    await seedProductFeedbackIfEmpty()
    expect(insert).toHaveBeenCalledWith(productFeedback)
    expect(values).toHaveBeenCalledTimes(1)
    const row = (values.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(row.status).toBe('approved')
    expect(FEEDBACK_STATUSES).toContain(row.status)
    expect(REPLY_TAGS).toContain(row.replyTag)
    expect(row.orgId).toBeUndefined()
    expect(row.userId).toBeUndefined()
    expect(typeof row.authorLabel).toBe('string')
  })

  it('treats a missing count row as empty', async () => {
    count.mockReturnValue([])
    await seedProductFeedbackIfEmpty()
    expect(insert).toHaveBeenCalledTimes(1)
  })
})
