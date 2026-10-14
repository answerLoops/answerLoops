/**
 * Public list prices for models answerLoops runs on its own key, in
 * micro-dollars (1 USD = 1,000,000) per 1M tokens. Used to meter included
 * platform AI usage per workspace (lib/billing/platform-ai-budget.ts).
 *
 * Source: https://developers.openai.com/api/docs/pricing, standard tier,
 * short context, checked 2026-10-13. Update this table whenever a DEFAULT_*
 * model in lib/ai/models.ts changes or OpenAI changes list prices;
 * tests/unit/ai-pricing.test.ts fails if a default has no entry.
 * Embedding models have no cached-input or output price, so cached input
 * is priced like input and output is zero.
 */
export interface ModelPrice {
  inputPerMillionMicros: number
  cachedInputPerMillionMicros: number
  outputPerMillionMicros: number
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'gpt-5.6-terra': { inputPerMillionMicros: 2_000_000, cachedInputPerMillionMicros: 200_000, outputPerMillionMicros: 12_000_000 },
  'gpt-5.6-luna': { inputPerMillionMicros: 200_000, cachedInputPerMillionMicros: 20_000, outputPerMillionMicros: 1_200_000 },
  'text-embedding-3-small': { inputPerMillionMicros: 20_000, cachedInputPerMillionMicros: 20_000, outputPerMillionMicros: 0 },
  'text-embedding-3-large': { inputPerMillionMicros: 130_000, cachedInputPerMillionMicros: 130_000, outputPerMillionMicros: 0 },
  'text-embedding-ada-002': { inputPerMillionMicros: 100_000, cachedInputPerMillionMicros: 100_000, outputPerMillionMicros: 0 },
}

/** Token counts for one call. `input` excludes cached input tokens. */
export interface TokenUsage {
  input: number
  cachedInput: number
  output: number
}

export function hasPrice(modelId: string): boolean {
  return Object.hasOwn(MODEL_PRICES, modelId)
}

export function costMicros(modelId: string, usage: TokenUsage): number {
  if (!hasPrice(modelId)) throw new Error(`No price for model ${modelId}`)
  const price = MODEL_PRICES[modelId]
  const total =
    usage.input * price.inputPerMillionMicros +
    usage.cachedInput * price.cachedInputPerMillionMicros +
    usage.output * price.outputPerMillionMicros
  return Math.ceil(total / 1_000_000)
}
