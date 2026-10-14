import { wrapEmbeddingModel, wrapLanguageModel } from 'ai'
import { costMicros, type TokenUsage } from '@/lib/ai/pricing'
import { recordSpend } from '@/lib/billing/platform-ai-budget'
import type { BudgetKind, BudgetTier } from '@/lib/ai/errors'
import { logger } from '@/lib/logger'

const MOD = 'ai/metering'

// Provider-spec types, taken from the AI SDK's own wrap signatures so this
// module needs no direct dependency on @ai-sdk/provider.
type LanguageModelV3 = Parameters<typeof wrapLanguageModel>[0]['model']
type EmbeddingModelV3 = Parameters<typeof wrapEmbeddingModel>[0]['model']
type GenerateResult = Awaited<ReturnType<LanguageModelV3['doGenerate']>>
type CallOptions = Parameters<LanguageModelV3['doGenerate']>[0]
type StreamPart = Awaited<ReturnType<LanguageModelV3['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never
type ProviderUsage = GenerateResult['usage']

export interface MeteringTarget {
  orgId: number
  tier: BudgetTier
  modelId: string
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function toTokenUsage(usage: ProviderUsage | undefined, fallback: () => TokenUsage, target: MeteringTarget): TokenUsage {
  const input = usage?.inputTokens
  const output = usage?.outputTokens
  if (input?.total === undefined || output?.total === undefined) {
    logger.warn('provider reported no usage; spend estimated from text length', { module: MOD, orgId: target.orgId, modelId: target.modelId })
    return fallback()
  }
  const cached = input.cacheRead ?? 0
  return { input: Math.max(0, input.total - cached), cachedInput: cached, output: output.total }
}

function record(target: MeteringTarget, kind: BudgetKind, usage: TokenUsage): void {
  // Fire and forget: the customer's request must not fail because our
  // bookkeeping did. A failed write is an error to look at, not a retry.
  let micros: number
  try {
    micros = costMicros(target.modelId, usage)
  } catch (error) {
    logger.error('failed to price platform AI call', { module: MOD, orgId: target.orgId, kind, modelId: target.modelId, error })
    return
  }
  recordSpend(target.orgId, kind, target.tier, micros).catch((error) => {
    logger.error('failed to record platform AI spend', { module: MOD, orgId: target.orgId, kind, error })
  })
}

function estimateChat(params: CallOptions, outText: string): TokenUsage {
  return { input: estimateTokens(JSON.stringify(params.prompt)), cachedInput: 0, output: estimateTokens(outText) }
}

/** Records the priced usage of every generate and stream call on a platform-billed chat model. */
export function meterLanguageModel(model: LanguageModelV3, target: MeteringTarget): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      wrapGenerate: async ({ doGenerate, params }) => {
        const result = await doGenerate()
        const outText = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
        record(target, 'chat', toTokenUsage(result.usage, () => estimateChat(params, outText), target))
        return result
      },
      wrapStream: async ({ doStream, params }) => {
        const { stream, ...rest } = await doStream()
        let outText = ''
        const metered = stream.pipeThrough(new TransformStream<StreamPart, StreamPart>({
          transform(part, controller) {
            if (part.type === 'text-delta') outText += part.delta
            if (part.type === 'finish') {
              record(target, 'chat', toTokenUsage(part.usage, () => estimateChat(params, outText), target))
            }
            controller.enqueue(part)
          },
        }))
        return { stream: metered, ...rest }
      },
    },
  })
}

/** Records the priced usage of every embed call on a platform-billed embedding model. */
export function meterEmbeddingModel(model: EmbeddingModelV3, target: MeteringTarget): EmbeddingModelV3 {
  return wrapEmbeddingModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      wrapEmbed: async ({ doEmbed, params }) => {
        const result = await doEmbed()
        let tokens = result.usage?.tokens
        if (tokens === undefined) {
          logger.warn('provider reported no usage; spend estimated from text length', { module: MOD, orgId: target.orgId, modelId: target.modelId })
          tokens = estimateTokens(params.values.join(''))
        }
        record(target, 'embedding', { input: tokens, cachedInput: 0, output: 0 })
        return result
      },
    },
  })
}
