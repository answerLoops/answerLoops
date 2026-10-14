import { openai, createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createMistral } from '@ai-sdk/mistral'
import type { EmbeddingModel, LanguageModel } from 'ai'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { getDeploymentMode } from '@/lib/billing/plans'
import { XAI_BASE_URL } from '@/lib/ai/list-models'
import { createSafeProviderFetch } from '@/lib/ai/safe-provider-fetch'
import { NoAIProviderConfiguredError } from '@/lib/ai/errors'
import { getBillingTier, assertBudget, type BudgetCheckOptions } from '@/lib/billing/platform-ai-budget'
import type { BudgetKind } from '@/lib/ai/errors'
import type { OrgAIConfig } from '@/lib/db/queries/ai-config'
import { meterLanguageModel, meterEmbeddingModel, type MeteringTarget } from '@/lib/ai/metering'
import {
  embeddingDimensionsSupported,
  getPlatformModel,
  platformEmbedding,
  roleForDefault,
  type PlatformRole,
} from '@/lib/ai/platform-models'
import { embeddingTargetFor, ensurePin, getPinnedModel } from '@/lib/ai/embedding-pin'
import { hasPrice } from '@/lib/ai/pricing'
import { logger } from '@/lib/logger'

export { NoAIProviderConfiguredError, PlatformBudgetExhaustedError } from '@/lib/ai/errors'
export { DEFAULT_CHAT_MODEL, DEFAULT_FAST_MODEL, DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/model-defaults'

const MOD = 'ai/models'

// Clients pointed at a tenant-supplied base URL send every request through a
// fetch that only reaches public https hosts, connecting to the validated
// address. First-party provider endpoints keep the SDK's default fetch.
const customEndpointFetch = createSafeProviderFetch()

/*
 * Who pays for a model call:
 * - a workspace with its own provider uses it, with the models it chose;
 * - self-hosted uses the operator's own .env key with the requested model;
 * - a hosted workspace without its own provider runs on the platform's
 *   models (lib/ai/platform-models.ts, never a model it saved) within its
 *   included usage, metered per call (lib/billing/platform-ai-budget.ts).
 *   With no live subscription, an unusable platform model, or the budget
 *   used up, callers get NoAIProviderConfiguredError (or its
 *   PlatformBudgetExhaustedError subclass) and degrade gracefully.
 */

/**
 * The platform model for a hosted workspace with no provider of its own:
 * refused when that role's model is unusable, when there is no live
 * subscription, or when the included usage for this kind of call is used
 * up; otherwise metered.
 */
async function platformBilled<M>(
  orgId: number,
  role: PlatformRole,
  build: (id: string) => M,
  meter: (model: M, target: MeteringTarget) => M,
  budgetOptions?: BudgetCheckOptions,
): Promise<M> {
  const modelId = getPlatformModel(role)
  if (!modelId) throw new NoAIProviderConfiguredError(orgId)
  return meteredPlatformModel(orgId, role === 'embedding' ? 'embedding' : 'chat', modelId, build, meter, budgetOptions)
}

/** A specific model on the platform key, for a workspace with a live subscription and budget left; metered. */
async function meteredPlatformModel<M>(
  orgId: number,
  kind: BudgetKind,
  modelId: string,
  build: (id: string) => M,
  meter: (model: M, target: MeteringTarget) => M,
  budgetOptions?: BudgetCheckOptions,
): Promise<M> {
  const tier = await getBillingTier(orgId)
  if (!tier) throw new NoAIProviderConfiguredError(orgId)
  if (budgetOptions) await assertBudget(orgId, kind, tier, budgetOptions)
  else await assertBudget(orgId, kind, tier)
  return meter(build(modelId), { orgId, tier, modelId })
}

/** The workspace's own embedding provider, serving the given model. */
function ownEmbeddingModel(cfg: OrgAIConfig, modelId: string): EmbeddingModel {
  const embKey = cfg.embedding_api_key ?? (cfg.chat_provider === 'openai' ? cfg.chat_api_key : null)
  return createOpenAI({
    apiKey: embKey ?? undefined,
    baseURL: cfg.embedding_base_url ?? undefined,
    ...(cfg.embedding_base_url ? { fetch: customEndpointFetch } : {}),
  }).embedding(modelId)
}

export async function chatModel(defaultId: string, orgId?: number): Promise<LanguageModel> {
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
      // fall through to the platform key
    }

    if (getDeploymentMode() === 'self-hosted') return openai(defaultId)
    return platformBilled(orgId, roleForDefault(defaultId), (id) => openai(id), meterLanguageModel)
  }

  return openai(defaultId)
}

/**
 * Embedding model for a workspace, plus the id of the model it runs, so
 * callers that store vectors can record which model made them. Pin-aware:
 * while a workspace's stored vectors are on a different model than its
 * target (lib/ai/embedding-pin.ts), it keeps using the pinned model so new
 * queries stay comparable with what is stored, until the re-embed job
 * switches it. The pinned model is served by whoever serves the target: the
 * workspace's own provider, or the platform under the same subscription,
 * budget and metering as any other platform call.
 */
export async function resolveEmbedding(defaultId: string, orgId?: number): Promise<{ model: EmbeddingModel; modelId: string }> {
  if (MOCK_EXTERNALS) {
    // Pinned like any other workspace, so search (which filters on the pin)
    // finds what mock mode stores.
    const modelId = orgId === undefined ? defaultId : ((await getPinnedModel(orgId)) ?? (await ensurePin(orgId, defaultId)))
    const { mockEmbeddingModel } = await import('@/lib/ai/mock')
    return { model: mockEmbeddingModel(modelId), modelId }
  }
  if (orgId === undefined) return { model: openai.embedding(defaultId), modelId: defaultId }

  const cfg = await getOrgAIConfig(orgId).catch(() => null)
  const selfHosted = getDeploymentMode() === 'self-hosted'
  const target = embeddingTargetFor(cfg, selfHosted ? defaultId : getPlatformModel('embedding'))
  if (!target) throw new NoAIProviderConfiguredError(orgId)
  const budgetOptions: BudgetCheckOptions = { ownChatProvider: !!(cfg?.chat_api_key || cfg?.chat_provider === 'openai-compatible') }

  const pin = (await getPinnedModel(orgId)) ?? (await ensurePin(orgId, target.modelId))
  const modelId = pin

  // The workspace's own provider serves both its target and, while a
  // re-embed is pending, the model its stored vectors are on.
  if (target.own && cfg) return { model: ownEmbeddingModel(cfg, modelId), modelId }

  if (selfHosted) {
    const served = pin === target.modelId || (hasPrice(pin) && embeddingDimensionsSupported(pin)) ? pin : target.modelId
    return { model: openai.embedding(served), modelId: served }
  }

  if (pin === target.modelId) {
    const model = await platformBilled(orgId, 'embedding', platformEmbedding, meterEmbeddingModel, budgetOptions)
    return { model, modelId }
  }

  // Re-embed pending toward the platform model: the pinned model, on the
  // platform key, metered and budget-checked like any other platform call.
  if (hasPrice(pin) && embeddingDimensionsSupported(pin)) {
    const model = await meteredPlatformModel(orgId, 'embedding', pin, platformEmbedding, meterEmbeddingModel, budgetOptions)
    return { model, modelId: pin }
  }
  logger.warn('pinned embedding model unavailable; using target until re-embed completes', { module: MOD, orgId, pin, target: target.modelId })
  const model = await platformBilled(orgId, 'embedding', platformEmbedding, meterEmbeddingModel, budgetOptions)
  return { model, modelId: target.modelId }
}

export async function embeddingModel(defaultId: string, orgId?: number): Promise<EmbeddingModel> {
  return (await resolveEmbedding(defaultId, orgId)).model
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
    // xAI's Grok API is OpenAI-compatible — no dedicated @ai-sdk/xai package
    // needed, just the OpenAI client pointed at xAI's base URL.
    case 'xai':
      return createOpenAI({
        apiKey: apiKey ?? undefined,
        baseURL: baseUrl ?? XAI_BASE_URL,
        ...(baseUrl ? { fetch: customEndpointFetch } : {}),
      })
    case 'openai-compatible':
      return createOpenAI({
        apiKey: apiKey ?? undefined,
        baseURL: baseUrl ?? undefined,
        ...(baseUrl ? { fetch: customEndpointFetch } : {}),
      })
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
    ...(baseUrl ? { fetch: customEndpointFetch } : {}),
  }).embedding(modelId)
}
