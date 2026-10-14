import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'

// A client built from a workspace's own AI settings must only ever send the
// credentials that workspace configured. These drive the real provider
// clients and record the outgoing requests, with the deployment's own
// provider keys set in the environment, and assert none of them leave.

const ENV_SENTINEL = 'deployment-env-provider-key'

const h = vi.hoisted(() => ({ requests: [] as { url: string; headers: Headers }[] }))

async function record(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init)
  h.requests.push({ url: req.url, headers: new Headers(init?.headers ?? req.headers) })
  return new Response(JSON.stringify({ error: { message: 'recorded' } }), { status: 401, headers: { 'content-type': 'application/json' } })
}

vi.mock('@/lib/ai/safe-provider-fetch', () => ({ createSafeProviderFetch: () => record }))

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }]

function sentHeaders(): string[] {
  return h.requests.flatMap((r) => [...r.headers.entries()].map(([k, v]) => `${k}: ${v}`))
}

async function attemptChat(model: { doGenerate: (o: never) => Promise<unknown> }) {
  await model.doGenerate({ prompt } as never).catch(() => undefined)
}

async function attemptEmbed(model: unknown) {
  await (model as { doEmbed: (o: { values: string[] }) => Promise<unknown> }).doEmbed({ values: ['hi'] }).catch(() => undefined)
}

const realFetch = globalThis.fetch

beforeEach(() => {
  h.requests.length = 0
  vi.stubEnv('OPENAI_API_KEY', ENV_SENTINEL)
  vi.stubEnv('ANTHROPIC_API_KEY', ENV_SENTINEL)
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', ENV_SENTINEL)
  vi.stubEnv('GROQ_API_KEY', ENV_SENTINEL)
  vi.stubEnv('MISTRAL_API_KEY', ENV_SENTINEL)
  globalThis.fetch = record as typeof fetch
})

afterEach(() => {
  vi.unstubAllEnvs()
  globalThis.fetch = realFetch
})

describe('chat clients built from workspace settings', () => {
  it.each([
    ['openai-compatible', 'https://tenant.example/v1'],
    ['xai', 'https://tenant.example/v1'],
    ['xai', null],
    ['openai', null],
    ['anthropic', null],
    ['google', null],
    ['groq', null],
    ['mistral', null],
  ])('%s with no key (base URL %s) never sends a key from the environment', async (provider, baseUrl) => {
    const { buildChatProvider } = await import('@/lib/ai/models')
    await attemptChat(buildChatProvider(provider, null, baseUrl)('some-model') as never)
    expect(h.requests.length).toBeGreaterThan(0)
    expect(sentHeaders().join('\n')).not.toContain(ENV_SENTINEL)
  })

  it('still sends the key the workspace configured', async () => {
    const { buildChatProvider } = await import('@/lib/ai/models')
    await attemptChat(buildChatProvider('openai-compatible', 'workspace-configured-key', 'https://tenant.example/v1')('m') as never)
    expect(sentHeaders().join('\n')).toContain('workspace-configured-key')
  })
})

describe('embedding clients built from workspace settings', () => {
  it('buildEmbeddingModel with no key and a custom endpoint never sends a key from the environment', async () => {
    const { buildEmbeddingModel } = await import('@/lib/ai/models')
    await attemptEmbed(buildEmbeddingModel('some-embedding', null, 'https://tenant.example/v1'))
    expect(h.requests.length).toBeGreaterThan(0)
    expect(sentHeaders().join('\n')).not.toContain(ENV_SENTINEL)
  })

  it('ownEmbeddingModel with a keyless custom endpoint never sends a key from the environment', async () => {
    const { ownEmbeddingModel } = await import('@/lib/ai/models')
    const cfg = {
      chat_provider: 'anthropic', chat_api_key: null, chat_base_url: null, chat_model: 'x',
      embedding_provider: 'openai-compatible', embedding_model: 'some-embedding', embedding_api_key: null,
      embedding_base_url: 'https://tenant.example/v1',
    }
    await attemptEmbed(ownEmbeddingModel(cfg as never, 'some-embedding'))
    expect(h.requests.length).toBeGreaterThan(0)
    expect(sentHeaders().join('\n')).not.toContain(ENV_SENTINEL)
  })

  it('the re-embed job builds workspace clients through ownEmbeddingModel, not its own client', () => {
    const src = fs.readFileSync('lib/kb/embedding-migration.ts', 'utf-8')
    expect(src).toContain('ownEmbeddingModel(')
    expect(src).not.toContain('createOpenAI(')
  })
})
