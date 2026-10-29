import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import { chatModel, DEFAULT_CHAT_MODEL, DEFAULT_FAST_MODEL } from '@/lib/ai/models'
import { embedTexts } from '@/lib/ai/embed'
import { getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { costMicros, hasPrice } from '@/lib/ai/pricing'
import { judgeOutputSchema } from '@/lib/kb/support/validate'
import type { JudgeFn } from '@/lib/kb/support/assess'
import type { EmbedFn } from '@/lib/kb/support/similarity'

/**
 * The model that judges, and whether it differs from the one that answers. On
 * included usage the judge is the fast model and the answer comes from the chat
 * model, so they differ. A workspace on its own provider answers and judges
 * with the one model it configured, which is recorded as the same so the
 * dashboard and the calibration can say so.
 */
export async function judgeModelFor(orgId?: number): Promise<{ modelId: string; distinctFromAnswering: boolean }> {
  const cfg = orgId === undefined ? null : await getOrgAIConfig(orgId).catch(() => null)
  const own = !!(cfg?.chat_api_key || cfg?.chat_provider === 'openai-compatible')
  if (own) {
    const modelId = cfg?.chat_model || DEFAULT_FAST_MODEL
    return { modelId, distinctFromAnswering: false }
  }
  return { modelId: DEFAULT_FAST_MODEL, distinctFromAnswering: String(DEFAULT_FAST_MODEL) !== String(DEFAULT_CHAT_MODEL) }
}

/**
 * The live judge: one structured-output call that sees only the prompt. It has
 * no tools, no memory and no retrieval, and returns whatever the model
 * produced for validation. Errors propagate so the caller records a failure.
 */
export function liveJudge(orgId?: number): JudgeFn {
  return async ({ instructions, prompt }) => {
    const { modelId } = await judgeModelFor(orgId)
    // Built per call, like the other agents, because the model is resolved per workspace.
    const agent = new Agent({
      id: 'support-judge',
      name: 'support-judge',
      instructions,
      model: (await chatModel(DEFAULT_FAST_MODEL, orgId)) as MastraModelConfig,
    })
    const result = await agent.generate(prompt, { structuredOutput: { schema: judgeOutputSchema } })
    const usage = result.usage
    return {
      raw: result.object ?? undefined,
      modelId,
      usage:
        usage && typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number'
          ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
          : undefined,
    }
  }
}

/** The live embedding call for the similarity check. */
export function liveEmbed(orgId?: number): EmbedFn {
  return async (texts) => {
    const { embeddings, tokens } = await embedTexts(texts, orgId)
    return { embeddings, tokens }
  }
}

/**
 * What one assessment cost, in micro-dollars, from the tokens it used, or null
 * when a model has no listed price (a workspace's own provider, for instance).
 */
export function assessmentCostMicros(
  usage: { judgeInputTokens: number; judgeOutputTokens: number; embeddingTokens: number },
  judgeModelId: string,
  embeddingModelId: string
): number | null {
  if (!hasPrice(judgeModelId) || !hasPrice(embeddingModelId)) return null
  return (
    costMicros(judgeModelId, { input: usage.judgeInputTokens, cachedInput: 0, output: usage.judgeOutputTokens }) +
    costMicros(embeddingModelId, { input: usage.embeddingTokens, cachedInput: 0, output: 0 })
  )
}
