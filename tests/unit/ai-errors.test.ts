import { describe, it, expect } from 'vitest'
import {
  NoAIProviderConfiguredError,
  PlatformBudgetExhaustedError,
  aiUnavailableMessage,
} from '@/lib/ai/errors'
import { NoAIProviderConfiguredError as FromModels } from '@/lib/ai/models'

// A workspace whose included platform AI usage is used up has, from every
// caller's point of view, no usable provider for that call. Subclassing the
// provider error is what lets the 16 existing degrade-gracefully handlers
// (ingest loops abort, retrieval degrades, tickets keep placeholder triage)
// cover it without each being edited.

describe('PlatformBudgetExhaustedError', () => {
  it('is a NoAIProviderConfiguredError, so every existing degrade path handles it', () => {
    const err = new PlatformBudgetExhaustedError(7, 'chat', 'plan')
    expect(err).toBeInstanceOf(NoAIProviderConfiguredError)
    expect(err.name).toBe('PlatformBudgetExhaustedError')
    expect(err.kind).toBe('chat')
    expect(err.tier).toBe('plan')
  })

  it('models.ts re-exports the same class', () => {
    expect(FromModels).toBe(NoAIProviderConfiguredError)
  })

  it.each([
    ['chat', 'plan', 'included AI usage for answers this month', 'keep drafting answers'],
    ['chat', 'trial', 'included trial AI usage for answers', 'keep drafting answers'],
    ['embedding', 'plan', 'included AI usage for knowledge-base processing this month', 'keep importing content and searching your knowledge base'],
    ['embedding', 'trial', 'included trial AI usage for knowledge-base processing', 'keep importing content and searching your knowledge base'],
  ] as const)('%s/%s message names the budget and the fix, with no amounts', (kind, tier, phrase, action) => {
    const msg = new PlatformBudgetExhaustedError(1, kind, tier).userMessage
    expect(msg).toContain(phrase)
    expect(msg).toContain('Settings → AI Model')
    expect(msg).toContain(action)
    expect(msg).not.toMatch(/\$|\d/)
  })
})

describe('aiUnavailableMessage', () => {
  it('returns the budget message for a budget error', () => {
    const err = new PlatformBudgetExhaustedError(1, 'embedding', 'trial')
    expect(aiUnavailableMessage(err, 'fallback')).toBe(err.userMessage)
  })

  it('returns the fallback for a plain provider error', () => {
    expect(aiUnavailableMessage(new NoAIProviderConfiguredError(1), 'fallback')).toBe('fallback')
  })
})
