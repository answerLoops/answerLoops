/**
 * Thrown by chatModel()/embeddingModel() when a workspace has no usable AI
 * provider for a call — instead of silently spending the platform's own key.
 * Callers on every real production path (bot listeners, widget chat,
 * MCP/Agent API) must catch this specifically and degrade gracefully (skip
 * drafting, surface a "connect an AI provider" state) rather than let it
 * bubble up as a generic 500. See lib/ai/models.ts for when it is thrown.
 */
export class NoAIProviderConfiguredError extends Error {
  constructor(orgId: number, message = `No AI provider configured for org ${orgId}`) {
    super(message)
    this.name = 'NoAIProviderConfiguredError'
  }
}

export type BudgetKind = 'chat' | 'embedding'
export type BudgetTier = 'trial' | 'plan'

const KIND_LABEL: Record<BudgetKind, string> = {
  chat: 'answers',
  embedding: 'knowledge-base processing',
}

const KIND_ACTION: Record<BudgetKind, string> = {
  chat: 'keep drafting answers',
  embedding: 'keep importing content and searching your knowledge base',
}

/**
 * The workspace's included platform AI usage for this kind of call is used
 * up. Subclasses NoAIProviderConfiguredError on purpose: from a caller's point
 * of view there is no usable provider for this call, and every existing
 * handler for that case already does the right thing. Routes that show the
 * reason to a person use aiUnavailableMessage() to pick up userMessage.
 */
export class PlatformBudgetExhaustedError extends NoAIProviderConfiguredError {
  readonly kind: BudgetKind
  readonly tier: BudgetTier
  readonly userMessage: string

  /**
   * `ownChatProvider`: the workspace already runs answers on its own key, so
   * only knowledge-base processing is on included usage, and the fix is an
   * embedding key rather than "add your AI provider".
   */
  constructor(orgId: number, kind: BudgetKind, tier: BudgetTier, options: { ownChatProvider?: boolean } = {}) {
    super(orgId, `Platform AI ${kind} budget exhausted for org ${orgId} (${tier})`)
    this.name = 'PlatformBudgetExhaustedError'
    this.kind = kind
    this.tier = tier
    const usage = tier === 'trial'
      ? `included trial AI usage for ${KIND_LABEL[kind]}`
      : `included AI usage for ${KIND_LABEL[kind]} this month`
    const fix = kind === 'embedding' && options.ownChatProvider
      ? 'Add an OpenAI embedding key under Embeddings in Settings → AI Model'
      : 'Add your AI provider in Settings → AI Model'
    this.userMessage = `This workspace has used its ${usage}. ${fix} to ${KIND_ACTION[kind]}.`
  }
}

/** The budget message when that is why AI is unavailable, otherwise the caller's own message. */
export function aiUnavailableMessage(err: unknown, fallback: string): string {
  return err instanceof PlatformBudgetExhaustedError ? err.userMessage : fallback
}
