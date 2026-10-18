import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateText, embed } from 'ai'
import { MockLanguageModelV4, MockEmbeddingModelV4 } from 'ai/test'

// Guards the AI SDK v7 migration: dependency majors move together, the
// metering middleware is declared against the v4 provider spec, and the
// installed SDK really accepts it and returns v4 models. Behavior of the
// metering itself is covered by ai-metering.test.ts.

const recordSpend = vi.fn()
vi.mock('@/lib/billing/platform-ai-budget', () => ({ recordSpend: (...a: unknown[]) => recordSpend(...a) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { meterLanguageModel, meterEmbeddingModel } from '@/lib/ai/metering'

const root = join(__dirname, '..', '..')
const major = (range: string): number => {
  const m = /(\d+)\.\d+\.\d+/.exec(range)
  if (!m) throw new Error(`unparseable version range: ${range}`)
  return Number(m[1])
}

beforeEach(() => {
  recordSpend.mockReset().mockResolvedValue(undefined)
})

describe('AI SDK dependency majors', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const deps = { ...pkg.devDependencies, ...pkg.dependencies }

  it('ai is v7 and every @ai-sdk provider is v4, together', () => {
    const providers = ['anthropic', 'google', 'groq', 'mistral', 'openai'].map((p) => `@ai-sdk/${p}`)
    const majors: Record<string, number> = { ai: major(deps.ai) }
    for (const p of providers) {
      expect(deps[p], `${p} must be a dependency`).toBeDefined()
      majors[p] = major(deps[p])
    }
    expect(majors).toEqual({ ai: 7, ...Object.fromEntries(providers.map((p) => [p, 4])) })
  })

  it('no other @ai-sdk package is left on a different major than the providers', () => {
    const stray = Object.entries(deps).filter(([name, range]) => name.startsWith('@ai-sdk/') && !/^@ai-sdk\/(react|provider|provider-utils)$/.test(name) && major(range) !== 4)
    expect(stray).toEqual([])
  })
})

describe('lib/ai/metering.ts source', () => {
  const src = readFileSync(join(root, 'lib/ai/metering.ts'), 'utf8')

  it('declares specificationVersion v4 for both language and embedding middleware', () => {
    const declared = src.match(/specificationVersion:\s*'v4'/g) ?? []
    expect(declared).toHaveLength(2)
    expect(src).toMatch(/wrapLanguageModel\(\{[\s\S]*?specificationVersion:\s*'v4'[\s\S]*?wrapGenerate/)
    expect(src).toMatch(/wrapEmbeddingModel\(\{[\s\S]*?specificationVersion:\s*'v4'[\s\S]*?wrapEmbed/)
  })

  it('contains no v3 spec references', () => {
    expect(src).not.toMatch(/v3/i)
  })
})

describe('installed ai SDK accepts the metering middleware', () => {
  const stop = { unified: 'stop' as const, raw: 'stop' }
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  }
  const target = { orgId: 3, tier: 'plan' as const, modelId: 'gpt-5.6-luna' }

  it('wrapLanguageModel returns a v4 model that still meters a call', async () => {
    const inner = new MockLanguageModelV4({
      doGenerate: async () => ({ content: [{ type: 'text', text: 'hi' }], finishReason: stop, usage, warnings: [] }),
    })
    const wrapped = meterLanguageModel(inner, target)
    expect(wrapped.specificationVersion).toBe('v4')
    expect(typeof wrapped.doGenerate).toBe('function')
    expect(typeof wrapped.doStream).toBe('function')
    const res = await generateText({ model: wrapped, prompt: 'q' })
    expect(res.text).toBe('hi')
    expect(recordSpend).toHaveBeenCalledTimes(1)
    expect(recordSpend).toHaveBeenCalledWith(3, 'chat', 'plan', expect.any(Number))
  })

  it('wrapEmbeddingModel returns a v4 model that still meters a call', async () => {
    const inner = new MockEmbeddingModelV4({ doEmbed: async () => ({ embeddings: [[0.1]], usage: { tokens: 12 }, warnings: [] }) })
    const wrapped = meterEmbeddingModel(inner, { orgId: 3, tier: 'plan', modelId: 'text-embedding-3-small' })
    expect(wrapped.specificationVersion).toBe('v4')
    expect(typeof wrapped.doEmbed).toBe('function')
    await embed({ model: wrapped, value: 'hello' })
    expect(recordSpend).toHaveBeenCalledTimes(1)
    expect(recordSpend).toHaveBeenCalledWith(3, 'embedding', 'plan', expect.any(Number))
  })
})
