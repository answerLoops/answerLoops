import { openai, createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createMistral } from '@ai-sdk/mistral'
import type { EmbeddingModel, LanguageModel } from 'ai'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { getDeploymentMode } from '@/lib/billing/plans'

/**
 * Thrown by chatModel()/embeddingModel() when a production call site on
 * managed cloud has no org-configured AI provider — instead of silently
 * spending the platform's own key. Callers on every real production path
 * (bot listeners, widget chat, MCP/Agent API) must catch this specifically
 * and degrade gracefully (skip drafting, surface a "connect an AI provider"
 * state) rather than let it bubble up as a generic 500. Only the sandbox
 * path (simulation) and self-hosted deployments (where the "platform key"
 * is the self-hoster's own .env, not answerLoops') may fall through to the
 * platform key — see the `purpose` param below.
 */
export class NoAIProviderConfiguredError extends Error {
  constructor(orgId: number) {
    super(`No AI provider configured for org ${orgId}`)
    this.name = 'NoAIProviderConfiguredError'
  }
}

/**
 * 'production' (default): the platform key may only be used as a fallback
 * on self-hosted deployments (where it's the self-hoster's own key). On
 * managed cloud, an org with no configured provider gets
 * NoAIProviderConfiguredError instead of silently running production
 * traffic on answerLoops' own bill.
 * 'sandbox': always falls through to the platform key regardless of
 * deployment mode — reserved for explicitly-a-test surfaces (simulation)
 * where running against the platform key is the intended, safe behavior.
 * 'trial': the caller has already atomically reserved one of the org's 5
 * lifetime free platform-key trial tickets (see
 * lib/billing/platform-key-trial.ts) before choosing this purpose — never
 * pass 'trial' speculatively, since this function does no metering of its
 * own and will use the platform key unconditionally.
 */
export type ModelPurpose = 'production' | 'sandbox' | 'trial'

// Platform default model IDs — the fallback used when an org has no AI
// provider configured (or no override for that call site). Centralized here
// so bumping a default means editing one constant, not hunting through every
// chatModel()/embeddingModel() call site across lib/ai, lib/agent, and the
// API routes that use them.
export const DEFAULT_CHAT_MODEL = 'gpt-4o'
export const DEFAULT_FAST_MODEL = 'gpt-4o-mini'
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

function platformKeyAllowed(purpose: ModelPurpose): boolean {
  return purpose === 'sandbox' || purpose === 'trial' || getDeploymentMode() === 'self-hosted'
}

export async function chatModel(
  defaultId: string,
  orgId?: number,
  purpose: ModelPurpose = 'production'
): Promise<LanguageModel> {
  if (MOCK_EXTERNALS) {
    return (require('./mock') as typeof import('./mock')).mockLanguageModel(defaultId)
  }

  if (orgId !== undefined) {
    try {
      const cfg = await getOrgAIConfig(orgId)
      if (cfg?.chat_api_key || cfg?.chat_provider === 'openai-compatible') {
        return buildChatProvider(cfg.chat_provider, cfg.chat_api_key, cfg.chat_base_url)(cfg.chat_model || defaultId)
      }
    } catch {
      // fall through to platform key
    }

    if (!platformKeyAllowed(purpose)) {
      throw new NoAIProviderConfiguredError(orgId)
    }
  }

  return openai(defaultId)
}

export async function embeddingModel(
  defaultId: string,
  orgId?: number,
  purpose: ModelPurpose = 'production'
): Promise<EmbeddingModel> {
  if (MOCK_EXTERNALS) {
    return (require('./mock') as typeof import('./mock')).mockEmbeddingModel(defaultId)
  }

  if (orgId !== undefined) {
    try {
      const cfg = await getOrgAIConfig(orgId)
      if (cfg) {
        const embKey = cfg.embedding_api_key ?? (cfg.chat_provider === 'openai' ? cfg.chat_api_key : null)
        if (embKey || cfg.embedding_base_url) {
          return createOpenAI({
            apiKey: embKey ?? undefined,
            baseURL: cfg.embedding_base_url ?? undefined,
          }).embedding(cfg.embedding_model || defaultId)
        }
      }
    } catch {
      // fall through to platform key
    }

    if (!platformKeyAllowed(purpose)) {
      throw new NoAIProviderConfiguredError(orgId)
    }
  }

  return openai.embedding(defaultId)
}

export function buildChatProvider(provider: string, apiKey: string | null, baseUrl: string | null) {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: apiKey ?? undefined })
    case 'google':
      return createGoogleGenerativeAI({ apiKey: apiKey ?? undefined })
    case 'groq':
      return createGroq({ apiKey: apiKey ?? undefined })
    case 'mistral':
      return createMistral({ apiKey: apiKey ?? undefined })
    case 'openai-compatible':
      return createOpenAI({ apiKey: apiKey ?? undefined, baseURL: baseUrl ?? undefined })
    default:
      return createOpenAI({ apiKey: apiKey ?? undefined })
  }
}

/**
 * Resolve an embedding model from an explicit provider/key/baseURL, without a
 * DB read — used by the "Test connection" action, which needs to try the
 * values the user just typed rather than what's persisted. Only OpenAI and
 * OpenAI-compatible endpoints do embeddings here, matching EMBEDDING_PROVIDERS.
 */
export function buildEmbeddingModel(
  modelId: string,
  apiKey: string | null,
  baseUrl: string | null,
): EmbeddingModel {
  return createOpenAI({
    apiKey: apiKey ?? undefined,
    baseURL: baseUrl ?? undefined,
  }).embedding(modelId)
}
