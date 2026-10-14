import { describe, it, expect, vi, beforeEach } from 'vitest'
import { embed } from 'ai'
import { MockEmbeddingModelV3 } from 'ai/test'

// The models answerLoops runs on its own key come from the hosting platform's
// environment, falling back to the code defaults. A model that can't be
// metered (no price) or can't fill the KB vector column is refused for that
// role rather than run.

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  for (const name of ['PLATFORM_AI_CHAT_MODEL', 'PLATFORM_AI_FAST_MODEL', 'PLATFORM_AI_EMBEDDING_MODEL']) vi.stubEnv(name, '')
})

async function load() {
  const error = vi.fn()
  vi.doMock('@/lib/logger', () => ({ logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
  return { mod: await import('@/lib/ai/platform-models'), defaults: await import('@/lib/ai/model-defaults'), error }
}

describe('readPlatformModels', () => {
  it('falls back to the code defaults when unset', async () => {
    const { mod, defaults: d } = await load()
    expect(mod.readPlatformModels({})).toEqual({ chat: d.DEFAULT_CHAT_MODEL, fast: d.DEFAULT_FAST_MODEL, embedding: d.DEFAULT_EMBEDDING_MODEL })
  })

  it('uses priced env values', async () => {
    const { mod } = await load()
    expect(mod.readPlatformModels({
      PLATFORM_AI_CHAT_MODEL: 'gpt-5.6-luna', PLATFORM_AI_FAST_MODEL: 'gpt-5.6-luna', PLATFORM_AI_EMBEDDING_MODEL: 'text-embedding-3-large',
    })).toEqual({ chat: 'gpt-5.6-luna', fast: 'gpt-5.6-luna', embedding: 'text-embedding-3-large' })
  })

  it('an unpriced model makes that role unusable', async () => {
    const { mod } = await load()
    expect(mod.readPlatformModels({ PLATFORM_AI_CHAT_MODEL: 'gpt-unknown' }).chat).toBeNull()
  })

  it('trims, and treats blank as unset', async () => {
    const { mod } = await load()
    expect(mod.readPlatformModels({ PLATFORM_AI_FAST_MODEL: '  gpt-5.6-terra ' }).fast).toBe('gpt-5.6-terra')
    expect(mod.readPlatformModels({ PLATFORM_AI_FAST_MODEL: '   ' }).fast).not.toBeNull()
  })

  it('a chat model as the embedding model, or an embedding model as chat, is unusable', async () => {
    const { mod } = await load()
    expect(mod.readPlatformModels({ PLATFORM_AI_EMBEDDING_MODEL: 'gpt-5.6-luna' }).embedding).toBeNull()
    expect(mod.readPlatformModels({ PLATFORM_AI_CHAT_MODEL: 'text-embedding-3-small' }).chat).toBeNull()
  })
})

describe('embeddingDimensionsSupported', () => {
  it.each([
    ['text-embedding-3-small', 'native'],
    ['text-embedding-ada-002', 'native'],
    ['text-embedding-3-large', 'param'],
    ['gpt-5.6-luna', false],
  ])('%s → %s', async (id, expected) => {
    const { mod } = await load()
    expect(mod.embeddingDimensionsSupported(id)).toBe(expected)
  })
})

describe('getPlatformModel', () => {
  it('logs an unusable role once and returns null', async () => {
    vi.stubEnv('PLATFORM_AI_CHAT_MODEL', 'gpt-unknown')
    const { mod, error } = await load()
    expect(mod.getPlatformModel('chat')).toBeNull()
    mod.getPlatformModel('chat')
    expect(error).toHaveBeenCalledTimes(1)
  })
})

describe('roleForDefault', () => {
  it('maps the fast default to fast and anything else to chat', async () => {
    const { mod, defaults: d } = await load()
    expect(mod.roleForDefault(d.DEFAULT_FAST_MODEL)).toBe('fast')
    expect(mod.roleForDefault(d.DEFAULT_CHAT_MODEL)).toBe('chat')
    expect(mod.roleForDefault('a-model-simulation-asked-for')).toBe('chat')
  })
})

describe('withKbDimensions', () => {
  it('asks the inner model for 1536 dimensions, keeping other provider options', async () => {
    const { mod } = await load()
    let seen: unknown
    const inner = new MockEmbeddingModelV3({
      doEmbed: async (opts) => { seen = opts.providerOptions; return { embeddings: [[0.1]], warnings: [] } },
    })
    await embed({ model: mod.withKbDimensions(inner), value: 'x', providerOptions: { openai: { user: 'u' } } })
    expect(seen).toEqual({ openai: { user: 'u', dimensions: 1536 } })
  })

  it('native models are not wrapped', async () => {
    const { mod } = await load()
    expect(mod.platformEmbedding('text-embedding-3-small').modelId).toBe('text-embedding-3-small')
    expect(mod.platformEmbedding('text-embedding-3-large').modelId).toBe('text-embedding-3-large')
  })
})
