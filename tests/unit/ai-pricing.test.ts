import { describe, it, expect } from 'vitest'
import { MODEL_PRICES, costMicros, hasPrice } from '@/lib/ai/pricing'
import { DEFAULT_CHAT_MODEL, DEFAULT_FAST_MODEL, DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/models'

// Included platform AI usage is metered by cost, so every model answerLoops
// can run on its own key needs a price. A default without one would either be
// refused (breaking AI for every workspace without a key) or, worse, run
// unmetered — this test fails first.

describe('MODEL_PRICES coverage', () => {
  it.each([DEFAULT_CHAT_MODEL, DEFAULT_FAST_MODEL, DEFAULT_EMBEDDING_MODEL, 'text-embedding-3-large', 'text-embedding-ada-002'])(
    '%s has a price',
    (id) => expect(hasPrice(id)).toBe(true),
  )

  it('embedding models have no output price', () => {
    for (const id of ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002']) {
      expect(MODEL_PRICES[id].outputPerMillionMicros).toBe(0)
    }
  })

  it('does not treat inherited object keys as priced models', () => {
    expect(hasPrice('toString')).toBe(false)
  })
})

describe('costMicros', () => {
  it('prices input, cached input and output separately', () => {
    const p = MODEL_PRICES[DEFAULT_CHAT_MODEL]
    const cost = costMicros(DEFAULT_CHAT_MODEL, { input: 1_000_000, cachedInput: 1_000_000, output: 1_000_000 })
    expect(cost).toBe(p.inputPerMillionMicros + p.cachedInputPerMillionMicros + p.outputPerMillionMicros)
  })

  it('rounds a fractional micro-dollar up, never down to zero', () => {
    expect(costMicros(DEFAULT_EMBEDDING_MODEL, { input: 1, cachedInput: 0, output: 0 })).toBe(1)
  })

  it('is zero only for zero usage', () => {
    expect(costMicros(DEFAULT_FAST_MODEL, { input: 0, cachedInput: 0, output: 0 })).toBe(0)
  })

  it('throws for an unpriced model', () => {
    expect(() => costMicros('not-a-model', { input: 1, cachedInput: 0, output: 0 })).toThrow(/No price/)
  })
})
