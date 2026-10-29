import { describe, it, expect, vi, beforeEach } from 'vitest'

// The live adapters only wire the pure assessment to a model and to embeddings.
// They are checked here with both mocked: what the judge is given, what it can
// and cannot do, which model it uses, and what a call costs.

const h = vi.hoisted(() => ({
  agentConfigs: [] as Array<Record<string, unknown>>,
  generate: vi.fn(),
  chatModel: vi.fn(async () => 'model-handle'),
  embedTexts: vi.fn(),
  getOrgAIConfig: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
}))

vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(config: Record<string, unknown>) {
      h.agentConfigs.push(config)
    }
    generate(prompt: string, options: unknown) {
      return h.generate(prompt, options)
    }
  },
}))
vi.mock('@/lib/ai/models', () => ({
  chatModel: h.chatModel,
  DEFAULT_CHAT_MODEL: 'gpt-5.6-terra',
  DEFAULT_FAST_MODEL: 'gpt-5.6-luna',
}))
vi.mock('@/lib/ai/embed', () => ({ embedTexts: h.embedTexts }))
vi.mock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: h.getOrgAIConfig }))

import { assessmentCostMicros, judgeModelFor, liveEmbed, liveJudge } from '@/lib/ai/support-judge'
import { judgeOutputSchema } from '@/lib/kb/support/validate'
import { SUPPORT_COST_CEILING_MICROS } from '@/lib/kb/support/method'

beforeEach(() => {
  vi.clearAllMocks()
  h.agentConfigs.length = 0
  h.getOrgAIConfig.mockResolvedValue(null)
})

describe('liveJudge', () => {
  it('sends the prompt to a tool-free, memory-free agent on the fast model, asking for the strict schema', async () => {
    h.generate.mockResolvedValue({ object: { findings: [], off_topic: [] }, usage: { inputTokens: 900, outputTokens: 40 } })
    const result = await liveJudge(7)({ instructions: 'the instructions', prompt: 'the prompt' })

    expect(h.chatModel).toHaveBeenCalledWith('gpt-5.6-luna', 7)
    const config = h.agentConfigs[0]
    expect(config.instructions).toBe('the instructions')
    expect(config).not.toHaveProperty('tools')
    expect(config).not.toHaveProperty('memory')
    expect(h.generate).toHaveBeenCalledWith('the prompt', { structuredOutput: { schema: judgeOutputSchema } })
    expect(result).toEqual({
      raw: { findings: [], off_topic: [] },
      modelId: 'gpt-5.6-luna',
      usage: { inputTokens: 900, outputTokens: 40 },
    })
  })

  it('returns no raw output, not an empty one, when the model produced none', async () => {
    h.generate.mockResolvedValue({ object: null, usage: undefined })
    expect((await liveJudge()({ instructions: 'i', prompt: 'p' })).raw).toBeUndefined()
  })

  it('leaves usage out rather than inventing it when the provider did not report it', async () => {
    h.generate.mockResolvedValue({ object: {}, usage: { inputTokens: undefined, outputTokens: 5 } })
    expect((await liveJudge()({ instructions: 'i', prompt: 'p' })).usage).toBeUndefined()
  })

  it('lets a provider error propagate so the caller records a failure', async () => {
    h.generate.mockRejectedValue(new Error('rate limited'))
    await expect(liveJudge(1)({ instructions: 'i', prompt: 'p' })).rejects.toThrow('rate limited')
  })
})

describe('judgeModelFor', () => {
  it('on included usage the judge is the fast model, which differs from the answering model', async () => {
    expect(await judgeModelFor(3)).toEqual({ modelId: 'gpt-5.6-luna', distinctFromAnswering: true })
  })

  it('with no workspace it is the same, the platform default', async () => {
    expect(await judgeModelFor()).toEqual({ modelId: 'gpt-5.6-luna', distinctFromAnswering: true })
  })

  it('a workspace on its own provider judges with its one model, recorded as the same as the answering model', async () => {
    h.getOrgAIConfig.mockResolvedValue({ chat_api_key: 'k', chat_provider: 'anthropic', chat_model: 'claude-sonnet-5-5' })
    expect(await judgeModelFor(3)).toEqual({ modelId: 'claude-sonnet-5-5', distinctFromAnswering: false })
  })

  it('an own-provider workspace with no model chosen falls back to the fast default', async () => {
    h.getOrgAIConfig.mockResolvedValue({ chat_api_key: 'k', chat_provider: 'openai', chat_model: '' })
    expect(await judgeModelFor(3)).toEqual({ modelId: 'gpt-5.6-luna', distinctFromAnswering: false })
  })

  it('treats an unreadable workspace config as included usage', async () => {
    h.getOrgAIConfig.mockRejectedValue(new Error('db down'))
    expect((await judgeModelFor(3)).distinctFromAnswering).toBe(true)
  })
})

describe('liveEmbed', () => {
  it('passes the texts to the workspace embedding call and returns the vectors and the tokens billed', async () => {
    h.embedTexts.mockResolvedValue({ embeddings: [[1], [2]], tokens: 33, model: 'text-embedding-3-small' })
    expect(await liveEmbed(9)(['a', 'b'])).toEqual({ embeddings: [[1], [2]], tokens: 33 })
    expect(h.embedTexts).toHaveBeenCalledWith(['a', 'b'], 9)
  })
})

describe('assessmentCostMicros', () => {
  it('prices the judge call and the embeddings from the tokens used', () => {
    // 2,200 in at 0.20/M + 300 out at 1.20/M = 440 + 360; 2,000 embedding tokens at 0.02/M = 40.
    expect(assessmentCostMicros({ judgeInputTokens: 2_200, judgeOutputTokens: 300, embeddingTokens: 2_000 }, 'gpt-5.6-luna', 'text-embedding-3-small')).toBe(840)
  })

  it('a typical answer costs well under the per-answer ceiling', () => {
    const cost = assessmentCostMicros({ judgeInputTokens: 2_200, judgeOutputTokens: 300, embeddingTokens: 2_000 }, 'gpt-5.6-luna', 'text-embedding-3-small')!
    expect(cost).toBeLessThan(SUPPORT_COST_CEILING_MICROS / 3)
  })

  it('is null for a model with no listed price, instead of guessing', () => {
    expect(assessmentCostMicros({ judgeInputTokens: 1, judgeOutputTokens: 1, embeddingTokens: 1 }, 'claude-sonnet-5-5', 'text-embedding-3-small')).toBeNull()
    expect(assessmentCostMicros({ judgeInputTokens: 1, judgeOutputTokens: 1, embeddingTokens: 1 }, 'gpt-5.6-luna', 'some-local-embedder')).toBeNull()
  })

  it('is zero for no usage', () => {
    expect(assessmentCostMicros({ judgeInputTokens: 0, judgeOutputTokens: 0, embeddingTokens: 0 }, 'gpt-5.6-luna', 'text-embedding-3-small')).toBe(0)
  })
})
