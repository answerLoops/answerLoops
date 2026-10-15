import { describe, it, expect, beforeEach, vi } from 'vitest'

const { recordArticleUsage, loggerError } = vi.hoisted(() => ({
  recordArticleUsage: vi.fn(),
  loggerError: vi.fn(),
}))
vi.mock('@/lib/db/queries/kb-usage', () => ({ recordArticleUsage }))
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { countArticleUsage } from '@/lib/kb/usage'

beforeEach(() => {
  recordArticleUsage.mockReset()
  loggerError.mockReset()
  recordArticleUsage.mockResolvedValue(undefined)
})

describe('countArticleUsage', () => {
  it('passes the ids of the entries that came from articles', async () => {
    await countArticleUsage(7, [{ articleId: 11 }, { articleId: 12 }])

    expect(recordArticleUsage).toHaveBeenCalledWith(7, [11, 12])
  })

  it('skips entries with no article id, such as answers reused from earlier tickets', async () => {
    await countArticleUsage(7, [{}, { articleId: 11 }, {}])

    expect(recordArticleUsage).toHaveBeenCalledWith(7, [11])
  })

  it('keeps an article id of zero rather than treating it as missing', async () => {
    await countArticleUsage(7, [{ articleId: 0 }])

    expect(recordArticleUsage).toHaveBeenCalledWith(7, [0])
  })

  it('never throws into the answer path: a failed write is logged and swallowed', async () => {
    recordArticleUsage.mockRejectedValue(new Error('db down'))

    await expect(countArticleUsage(7, [{ articleId: 11 }])).resolves.toBeUndefined()

    expect(loggerError).toHaveBeenCalledTimes(1)
  })
})
