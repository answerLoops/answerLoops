import { describe, it, expect, beforeEach, vi } from 'vitest'

const { recordArticleUsage, recordAnswerReferences, loggerError } = vi.hoisted(() => ({
  recordArticleUsage: vi.fn(),
  recordAnswerReferences: vi.fn(),
  loggerError: vi.fn(),
}))
vi.mock('@/lib/db/queries/kb-usage', () => ({ recordArticleUsage }))
vi.mock('@/lib/db/queries/kb-answers', () => ({ recordAnswerReferences }))
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { countArticleUsage, newAnswerId, recordAnswerSources } from '@/lib/kb/usage'

beforeEach(() => {
  recordArticleUsage.mockReset()
  recordAnswerReferences.mockReset()
  loggerError.mockReset()
  recordArticleUsage.mockResolvedValue(undefined)
  recordAnswerReferences.mockResolvedValue({ recorded: true })
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

const ANSWER = '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44'
const sources = (over: Partial<Parameters<typeof recordAnswerSources>[0]> = {}) =>
  recordAnswerSources({ orgId: 7, answerId: ANSWER, surface: 'widget', outcome: 'generated', context: [], ...over })

describe('recordAnswerSources', () => {
  it('stores every article supplied to the answer, in the order it was supplied (A, B and C)', async () => {
    await sources({ context: [{ articleId: 11 }, { articleId: 12 }, { articleId: 13 }] })

    expect(recordAnswerReferences).toHaveBeenCalledTimes(1)
    expect(recordAnswerReferences).toHaveBeenCalledWith({
      answerId: ANSWER,
      orgId: 7,
      surface: 'widget',
      outcome: 'generated',
      references: [
        { articleId: 11, rank: 1 },
        { articleId: 12, rank: 2 },
        { articleId: 13, rank: 3 },
      ],
    })
  })

  it('records only what was supplied: an article that was retrieved and dropped is simply not in the context', async () => {
    // The call sites pass the context handed to the model, so a candidate that
    // was dropped before generation never reaches this function.
    await sources({ context: [{ articleId: 11 }, { articleId: 13 }] })

    const refs = recordAnswerReferences.mock.calls[0][0].references
    expect(refs.map((r: { articleId: number }) => r.articleId)).toEqual([11, 13])
  })

  it('skips entries with no article id but keeps their place in the order', async () => {
    await sources({ context: [{}, { articleId: 11 }, {}, { articleId: 12 }] })

    expect(recordAnswerReferences.mock.calls[0][0].references).toEqual([
      { articleId: 11, rank: 2 },
      { articleId: 12, rank: 4 },
    ])
  })

  it('keeps an article id of zero rather than treating it as missing', async () => {
    await sources({ context: [{ articleId: 0 }] })

    expect(recordAnswerReferences.mock.calls[0][0].references).toEqual([{ articleId: 0, rank: 1 }])
  })

  it('still records the answer when no article was supplied', async () => {
    await sources({ context: [] })

    expect(recordAnswerReferences).toHaveBeenCalledTimes(1)
    expect(recordAnswerReferences.mock.calls[0][0].references).toEqual([])
  })

  it.each(['widget', 'ticket', 'discord', 'agent_api'] as const)('passes the %s surface through', async (surface) => {
    await sources({ surface })
    expect(recordAnswerReferences.mock.calls[0][0].surface).toBe(surface)
  })

  it('records a failed generation with the context that was supplied', async () => {
    await sources({ outcome: 'failed', context: [{ articleId: 11 }] })

    expect(recordAnswerReferences.mock.calls[0][0]).toMatchObject({
      outcome: 'failed',
      references: [{ articleId: 11, rank: 1 }],
    })
  })

  it('sends the same answer id every time it is called for one generation, so a retry writes it once', async () => {
    // The write is idempotent on the answer id (see kb-answers-queries.test.ts);
    // here, check the id is passed through unchanged on every call.
    await sources({ context: [{ articleId: 11 }] })
    await sources({ context: [{ articleId: 11 }] })

    expect(recordAnswerReferences.mock.calls.map((c) => c[0].answerId)).toEqual([ANSWER, ANSWER])
  })

  it('does not send the question, the reply or any visitor detail', async () => {
    await sources({ context: [{ articleId: 11 }] })

    expect(Object.keys(recordAnswerReferences.mock.calls[0][0]).sort()).toEqual(
      ['answerId', 'orgId', 'outcome', 'references', 'surface']
    )
  })

  it('never throws into the answer path: a failed write is logged and swallowed', async () => {
    recordAnswerReferences.mockRejectedValue(new Error('db down'))

    await expect(sources({ context: [{ articleId: 11 }] })).resolves.toBeUndefined()

    expect(loggerError).toHaveBeenCalledTimes(1)
  })

  it('does not touch the aggregate usage count', async () => {
    await sources({ context: [{ articleId: 11 }] })

    expect(recordArticleUsage).not.toHaveBeenCalled()
  })
})

describe('countArticleUsage is unchanged by answer recording', () => {
  it('still counts through its own query, and does not write answer references', async () => {
    await countArticleUsage(7, [{ articleId: 11 }, { articleId: 12 }])

    expect(recordArticleUsage).toHaveBeenCalledWith(7, [11, 12])
    expect(recordAnswerReferences).not.toHaveBeenCalled()
  })
})

describe('newAnswerId', () => {
  it('returns a UUID, and a new one each time', () => {
    const a = newAnswerId()
    const b = newAnswerId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})
