import { describe, it, expect, vi, beforeEach } from 'vitest'

// A local model wrote a triage `reasoning` over the 400-character schema limit.
// Validation threw and the whole enrichment job died with it. Wordy output
// should be trimmed, not fail the call.

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }))

vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    generate = generate
  },
}))
vi.mock('@/lib/ai/models', () => ({
  chatModel: vi.fn(async () => ({})),
  DEFAULT_FAST_MODEL: 'fast',
  NoAIProviderConfiguredError: class NoAIProviderConfiguredError extends Error {},
}))

import { boundText, REASONING_MAX_CHARS, SUMMARY_MAX_CHARS } from '@/lib/ai/bounded-text'
import { triageMessage } from '@/lib/ai/triage'
import { assessAnswer } from '@/lib/ai/assess'

describe('boundText', () => {
  it('leaves text within the limit untouched, including exactly at the limit', () => {
    expect(boundText('short', 400)).toBe('short')
    expect(boundText('x'.repeat(400), 400)).toBe('x'.repeat(400))
  })

  it('trims longer text to at most the limit and marks the cut', () => {
    const out = boundText('word '.repeat(300), 400)
    expect(out.length).toBeLessThanOrEqual(400)
    expect(out.endsWith('…')).toBe(true)
  })

  it('does not leave trailing whitespace before the ellipsis', () => {
    expect(boundText('abc   def', 5)).toBe('abc…')
  })
})

describe('structured-output schemas accept a wordy model', () => {
  beforeEach(() => generate.mockReset())

  const longReasoning = 'This reads like a how-to question about account recovery. '.repeat(20)
  const longSummary = 'The user cannot reach their old email address and asks how to recover the account. '.repeat(5)

  it('triage trims an over-long reasoning and summary instead of failing', async () => {
    generate.mockResolvedValue({
      object: { category: 'how_to', severity_score: 0.3, summary: longSummary, suggested_priority: 'medium', reasoning: longReasoning },
    })
    const result = await triageMessage('I cannot access my email, how do I recover my account?')
    expect(result.reasoning.length).toBeLessThanOrEqual(REASONING_MAX_CHARS)
    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS)
    expect(result.category).toBe('how_to')
  })

  it('triage hands the model a schema that does not reject long text', async () => {
    generate.mockResolvedValue({
      object: { category: 'bug', severity_score: 0.5, summary: 's', suggested_priority: 'low', reasoning: 'r' },
    })
    await triageMessage('anything')
    const { schema } = generate.mock.calls[0][1].structuredOutput
    const parsed = schema.safeParse({
      category: 'bug', severity_score: 0.5, summary: longSummary, suggested_priority: 'low', reasoning: longReasoning,
    })
    expect(parsed.success).toBe(true)
  })

  it('the confidence and category rules still hold', async () => {
    generate.mockResolvedValue({ object: { category: 'bug', severity_score: 0.5, summary: 's', suggested_priority: 'low', reasoning: 'r' } })
    await triageMessage('anything')
    const { schema } = generate.mock.calls[0][1].structuredOutput
    expect(schema.safeParse({ category: 'nonsense', severity_score: 0.5, summary: 's', suggested_priority: 'low', reasoning: 'r' }).success).toBe(false)
    expect(schema.safeParse({ category: 'bug', severity_score: 7, summary: 's', suggested_priority: 'low', reasoning: 'r' }).success).toBe(false)
  })

  it('the answer grader trims an over-long reasoning and keeps the score', async () => {
    generate.mockResolvedValue({ object: { confidence: 0.9, answered_fully: true, reasoning: longReasoning } })
    const result = await assessAnswer('How do I reset my password?', 'Use the forgot password link.', undefined, [])
    expect(result.reasoning.length).toBeLessThanOrEqual(REASONING_MAX_CHARS)
    expect(result.confidence).toBe(0.9)
    expect(result.answered_fully).toBe(true)
  })

  it('the answer grader schema does not reject long text but still bounds the confidence', async () => {
    generate.mockResolvedValue({ object: { confidence: 0.5, answered_fully: false, reasoning: 'r' } })
    await assessAnswer('q', 'a', undefined, [])
    const { schema } = generate.mock.calls[0][1].structuredOutput
    expect(schema.safeParse({ confidence: 0.5, answered_fully: true, reasoning: longReasoning }).success).toBe(true)
    expect(schema.safeParse({ confidence: 3, answered_fully: true, reasoning: 'r' }).success).toBe(false)
  })
})
