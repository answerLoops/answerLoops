import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'

// When a workspace's target embedding model changes (the platform's model in
// the environment, or the workspace's own), a background job re-embeds its
// knowledge base and ticket vectors from the text already stored, then
// switches the workspace over in one transaction. Customers never re-upload,
// search never mixes models, and the work is never charged to the
// workspace's included usage.

const SRC = () => fs.readFileSync('lib/kb/embedding-migration.ts', 'utf-8')

describe('candidate query', () => {
  it('mirrors hasOwnEmbeddingConfig and catches pin drift and stray rows', () => {
    const s = SRC()
    expect(s).toMatch(/c\.embedding_base_url IS NOT NULL/)
    expect(s).toMatch(/c\.embedding_api_key IS NOT NULL/)
    expect(s).toMatch(/c\.chat_provider = 'openai' AND c\.chat_api_key IS NOT NULL/)
    expect(s).toMatch(/a\.model <> o\.embedding_model_in_use/)
    expect(s).toMatch(/te\.model <> o\.embedding_model_in_use/)
  })
})

describe('switchIfComplete', () => {
  it('locks the org, refuses while unstaged rows remain, then swaps staged vectors live and moves the pin in one transaction', () => {
    const s = SRC()
    const sw = s.slice(s.indexOf('async function switchIfComplete'))
    expect(sw).toContain('.transaction(')
    expect(sw).toMatch(/FOR UPDATE/)
    expect(sw).toMatch(/model_next IS DISTINCT FROM/)
    expect(sw).toMatch(/SET embedding = embedding_next, embedding_vec = embedding_vec_next, model = model_next, embedding_next = NULL, embedding_vec_next = NULL, model_next = NULL/)
    expect(sw).toMatch(/SET vector = vector_next, model = model_next, vector_next = NULL, model_next = NULL/)
    expect(sw).toMatch(/UPDATE orgs SET embedding_model_in_use =/)
  })

  it('runs one worker per org at a time and always releases the lock', () => {
    expect(SRC()).toMatch(/pg_try_advisory_lock/)
    expect(SRC()).toMatch(/finally[\s\S]*pg_advisory_unlock/)
  })
})

describe('runEmbeddingMigration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
  })

  function fakeDb(opts: { locked: boolean; articleRows?: { id: number; question: string; answer: string }[]; remaining?: number }) {
    const executed: string[] = []
    let articleBatches = opts.articleRows ? 1 : 0
    const text = (q: unknown) => JSON.stringify(q)
    const db = {
      execute: async (q: unknown) => {
        const t = text(q)
        executed.push(t)
        if (t.includes('pg_try_advisory_lock')) return [{ locked: opts.locked }]
        if (t.includes('FROM kb_articles') && t.includes('ORDER BY id')) return articleBatches-- > 0 ? opts.articleRows : []
        return []
      },
      transaction: async (fn: (tx: { execute: (q: unknown) => Promise<unknown> }) => unknown) =>
        fn({ execute: async (q: unknown) => { executed.push(text(q)); return [{ remaining: opts.remaining ?? 0 }] } }),
    }
    return { db, executed }
  }

  it('re-embeds stored text with the target model, never meters, and switches when nothing is left', async () => {
    const embedMany = vi.fn(async ({ values }: { values: string[] }) => ({ embeddings: values.map(() => [0.5]) }))
    const { db, executed } = fakeDb({ locked: true, articleRows: [{ id: 1, question: 'q', answer: 'a' }] })
    vi.doMock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), embedMany }))
    vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => null }))
    vi.doMock('@/lib/ai/platform-models', async (orig) => ({
      ...(await orig<typeof import('@/lib/ai/platform-models')>()),
      getPlatformModel: () => 'text-embedding-3-large',
      platformEmbedding: (id: string) => ({ modelId: id }),
    }))
    vi.doMock('@/lib/billing/platform-ai-budget', () => { throw new Error('migration must not meter') })
    vi.doMock('@/lib/ai/metering', () => { throw new Error('migration must not meter') })
    vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))

    const { runEmbeddingMigration } = await import('@/lib/kb/embedding-migration')
    expect(await runEmbeddingMigration(3)).toEqual({ staged: 1, switched: true })
    expect(embedMany).toHaveBeenCalledWith(expect.objectContaining({ values: ['q\n\na'], model: { modelId: 'text-embedding-3-large' } }))
    expect(executed.some((t) => t.includes('embedding_model_in_use'))).toBe(true)
    expect(executed.some((t) => t.includes('pg_advisory_unlock'))).toBe(true)
  })

  it('does not switch while rows are still unstaged', async () => {
    const { db } = fakeDb({ locked: true, remaining: 2 })
    vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => null }))
    vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
    const { runEmbeddingMigration } = await import('@/lib/kb/embedding-migration')
    expect(await runEmbeddingMigration(3)).toEqual({ staged: 0, switched: false })
  })

  it('skips an org another worker holds', async () => {
    const { db, executed } = fakeDb({ locked: false })
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
    const { runEmbeddingMigration } = await import('@/lib/kb/embedding-migration')
    expect(await runEmbeddingMigration(3)).toEqual({ staged: 0, switched: false })
    expect(executed.some((t) => t.includes('pg_advisory_unlock'))).toBe(false)
  })
})
