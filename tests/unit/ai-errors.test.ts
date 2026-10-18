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

  it('records a monthly or trial limit as the skip reason, by tier', () => {
    expect(new PlatformBudgetExhaustedError(7, 'chat', 'plan').skipReason).toBe('ai_limit_reached')
    expect(new PlatformBudgetExhaustedError(7, 'chat', 'trial').skipReason).toBe('trial_ai_limit_reached')
  })

  it('a plain provider error defaults to the ai_unavailable skip reason', () => {
    expect(new NoAIProviderConfiguredError(7).skipReason).toBe('ai_unavailable')
  })

  it('models.ts re-exports the same class', () => {
    expect(FromModels).toBe(NoAIProviderConfiguredError)
  })

  it.each([
    ['chat', 'plan', "this month's AI limit for answers", 'keep drafting answers'],
    ['chat', 'trial', 'your trial AI limit for answers', 'keep drafting answers'],
    ['embedding', 'plan', "this month's AI limit for knowledge-base processing", 'keep importing content and searching your knowledge base'],
    ['embedding', 'trial', 'your trial AI limit for knowledge-base processing', 'keep importing content and searching your knowledge base'],
  ] as const)('%s/%s message names the budget and the fix, with no amounts', (kind, tier, phrase, action) => {
    const msg = new PlatformBudgetExhaustedError(1, kind, tier).userMessage
    expect(msg).toContain(phrase)
    expect(msg).toContain('Settings → AI Model')
    expect(msg).toContain(action)
    expect(msg).not.toMatch(/\$|\d/)
  })
})

describe('PlatformBudgetExhaustedError for a workspace with its own chat provider', () => {
  // Its answers already run on its own key; only knowledge-base processing
  // runs on included usage, and what removes that limit is an embedding key.
  it('the embedding message points at the embedding key, not "add your AI provider"', () => {
    const msg = new PlatformBudgetExhaustedError(1, 'embedding', 'plan', { ownChatProvider: true }).userMessage
    expect(msg).toContain("this month's AI limit for knowledge-base processing")
    expect(msg).toContain('Add an OpenAI embedding key under Embeddings in Settings → AI Model')
    expect(msg).not.toContain('Add your AI provider')
  })

  it('without the option the message is unchanged', () => {
    expect(new PlatformBudgetExhaustedError(1, 'embedding', 'plan').userMessage).toContain('Add your AI provider in Settings → AI Model')
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
