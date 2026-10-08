import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ embedText: vi.fn(async (t: string, orgId?: number) => [t.length, orgId ?? 0]) }))
vi.mock('@/lib/ai/embed', () => ({ embedText: h.embedText }))

import { clearEmbedQueryCache, embedQueryCached } from '@/lib/widget/embed-cache'

beforeEach(() => {
  clearEmbedQueryCache()
  h.embedText.mockClear()
})

describe('embedQueryCached', () => {
  it('embeds once for repeated and whitespace/case-variant queries from the same org', async () => {
    await embedQueryCached('How do I reset?', 1)
    await embedQueryCached('  how do i   reset? ', 1)
    expect(h.embedText).toHaveBeenCalledTimes(1)
  })

  it('never shares an entry across orgs', async () => {
    const a = await embedQueryCached('pricing', 1)
    const b = await embedQueryCached('pricing', 2)
    expect(h.embedText).toHaveBeenCalledTimes(2)
    expect(h.embedText).toHaveBeenLastCalledWith('pricing', 2)
    expect(a).not.toEqual(b)
  })

  it('expires entries after the TTL', async () => {
    vi.useFakeTimers()
    try {
      await embedQueryCached('q', 1)
      vi.advanceTimersByTime(10 * 60_000 + 1)
      await embedQueryCached('q', 1)
      expect(h.embedText).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds the cache size', async () => {
    for (let i = 0; i < 600; i++) await embedQueryCached(`query ${i}`, 1)
    h.embedText.mockClear()
    await embedQueryCached('query 0', 1) // evicted
    await embedQueryCached('query 599', 1) // retained
    expect(h.embedText).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed embedding', async () => {
    h.embedText.mockRejectedValueOnce(new Error('provider down'))
    await expect(embedQueryCached('q', 1)).rejects.toThrow()
    await embedQueryCached('q', 1)
    expect(h.embedText).toHaveBeenCalledTimes(2)
  })
})
