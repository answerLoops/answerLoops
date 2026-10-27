import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A model can answer a structured-output request with nothing usable: an empty
 * completion, a refusal with no body, or a content-filter stop. The agent
 * library then resolves with `object: undefined` instead of throwing.
 *
 * triageMessage and assessAnswer must turn that into a rejection. Callers
 * already degrade on a rejected call (assessment failed → human review), but
 * not on a call that resolves with undefined: lib/agent/core.ts only has a
 * .catch for rejections, so an undefined assessment reached shouldAutoDeflect
 * and threw a TypeError out of generateAnswerCore.
 */

const h = vi.hoisted(() => ({ generate: vi.fn() }))

vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    generate = h.generate
  },
}))

vi.mock('@/lib/ai/models', () => ({
  chatModel: async () => ({}),
  DEFAULT_FAST_MODEL: 'fast-model',
}))

import { assessAnswer, shouldAutoDeflect } from '@/lib/ai/assess'
import { triageMessage } from '@/lib/ai/triage'

beforeEach(() => {
  h.generate.mockReset()
})

describe('assessAnswer', () => {
  it('returns the structured assessment when the model produced one', async () => {
    h.generate.mockResolvedValue({ object: { confidence: 0.9, answered_fully: true, reasoning: 'ok' } })

    const a = await assessAnswer('How do I reset?', 'Open settings.', 1)

    expect(a).toEqual({ confidence: 0.9, answered_fully: true, reasoning: 'ok' })
    expect(shouldAutoDeflect(a)).toBe(true)
  })

  it.each([undefined, null])('rejects instead of resolving with %s when the model returned nothing usable', async (empty) => {
    h.generate.mockResolvedValue({ object: empty })

    await expect(assessAnswer('How do I reset?', 'Open settings.', 1)).rejects.toMatchObject({
      name: 'EmptyAIResponseError',
    })
  })
})

describe('triageMessage', () => {
  it('returns the triage result when the model produced one', async () => {
    h.generate.mockResolvedValue({
      object: { category: 'how_to', severity_score: 0.2, summary: 's', suggested_priority: 'low', reasoning: 'r' },
    })

    await expect(triageMessage('How do I reset?', 1)).resolves.toMatchObject({ category: 'how_to', severity_score: 0.2 })
  })

  it.each([undefined, null])('rejects with a named error, not a TypeError, when the model returned %s', async (empty) => {
    h.generate.mockResolvedValue({ object: empty })

    await expect(triageMessage('How do I reset?', 1)).rejects.toMatchObject({ name: 'EmptyAIResponseError' })
  })
})
