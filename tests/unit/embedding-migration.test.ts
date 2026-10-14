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
  const candidates = () => {
    const s = SRC()
    const start = s.indexOf('export async function listMigrationCandidates')
    return s.slice(start, s.indexOf('\n}\n', start))
  }

  it('mirrors hasOwnEmbeddingConfig and catches pin drift and stray rows', () => {
    const s = candidates()
    expect(s).toMatch(/c\.embedding_base_url IS NOT NULL/)
    expect(s).toMatch(/c\.embedding_api_key IS NOT NULL/)
    expect(s).toMatch(/c\.chat_provider = 'openai' AND c\.chat_api_key IS NOT NULL/)
    expect(s).toMatch(/a\.model <> o\.embedding_model_in_use/)
    expect(s).toMatch(/te\.model <> o\.embedding_model_in_use/)
  })

  it('skips workspaces another worker holds a lease on', () => {
    expect(candidates()).toMatch(/o\.embedding_migration_lease_until IS NULL OR o\.embedding_migration_lease_until < now\(\)/)
  })

  it('backs off workspaces that keep failing, so they cannot take every slot', () => {
    expect(candidates()).toMatch(/o\.embedding_migration_failures = 0/)
    expect(candidates()).toMatch(/power\(2, LEAST\(o\.embedding_migration_failures, \d+\)\)/)
  })

  it('serves the least recently attempted workspaces first', () => {
    expect(candidates()).toMatch(/ORDER BY o\.embedding_migration_attempted_at ASC NULLS FIRST, o\.id/)
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

  it('uses a lease row, not a session advisory lock (which leaks across pooled connections)', () => {
    expect(SRC()).not.toMatch(/pg_try_advisory_lock|pg_advisory_unlock/)
  })
})

describe('runEmbeddingMigration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
  })

  function fakeDb(opts: { leased: boolean; articleRows?: { id: number; question: string; answer: string }[]; remaining?: number }) {
    const executed: string[] = []
    let articleBatches = opts.articleRows ? 1 : 0
    const text = (q: unknown) => JSON.stringify(q)
    const db = {
      execute: async (q: unknown) => {
        const t = text(q)
        executed.push(t)
        if (t.includes('embedding_migration_lease_until = now()') && t.includes('RETURNING')) return opts.leased ? [{ id: 3 }] : []
        if (t.includes('FROM kb_articles') && t.includes('ORDER BY id')) return articleBatches-- > 0 ? opts.articleRows : []
        return []
      },
      transaction: async (fn: (tx: { execute: (q: unknown) => Promise<unknown> }) => unknown) =>
        fn({ execute: async (q: unknown) => { executed.push(text(q)); return [{ remaining: opts.remaining ?? 0 }] } }),
    }
    return { db, executed }
  }

  function common(o: { tier?: 'trial' | 'plan' | null; embedMany?: unknown } = {}) {
    vi.doMock('@/lib/db/queries/ai-config', () => ({ getOrgAIConfig: async () => null }))
    vi.doMock('@/lib/ai/platform-models', async (orig) => ({
      ...(await orig<typeof import('@/lib/ai/platform-models')>()),
      getPlatformModel: () => 'text-embedding-3-large',
      platformEmbedding: (id: string) => ({ modelId: id }),
    }))
    // Only the subscription lookup; budgets and metering must never be touched.
    vi.doMock('@/lib/billing/platform-ai-budget', () => ({ getBillingTier: async () => (o.tier === undefined ? 'plan' : o.tier) }))
    vi.doMock('@/lib/ai/metering', () => { throw new Error('migration must not meter') })
    vi.doMock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
    if (o.embedMany) vi.doMock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), embedMany: o.embedMany }))
  }

  const failuresIncremented = (executed: string[]) => executed.some((t) => t.includes('embedding_migration_failures + 1'))
  const failuresReset = (executed: string[]) => executed.some((t) => t.includes('embedding_migration_failures = 0'))
  const leaseCleared = (executed: string[]) => executed.some((t) => t.includes('embedding_migration_lease_until = NULL'))

  it('re-embeds stored text with the target model, never meters, switches when nothing is left, and resets the failure count', async () => {
    const embedMany = vi.fn(async ({ values }: { values: string[] }) => ({ embeddings: values.map(() => [0.5]) }))
    const { db, executed } = fakeDb({ leased: true, articleRows: [{ id: 1, question: 'q', answer: 'a' }] })
    common({ embedMany })
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))

    const { runEmbeddingMigration } = await import('@/lib/kb/embedding-migration')
    expect(await runEmbeddingMigration(3)).toEqual({ staged: 1, switched: true })
    expect(embedMany).toHaveBeenCalledWith(expect.objectContaining({ values: ['q\n\na'], model: { modelId: 'text-embedding-3-large' } }))
    expect(executed.some((t) => t.includes('UPDATE orgs SET embedding_model_in_use'))).toBe(true)
    expect(failuresReset(executed)).toBe(true)
    expect(leaseCleared(executed)).toBe(true)
  })

  it('does not switch while rows are still unstaged', async () => {
    const { db } = fakeDb({ leased: true, remaining: 2 })
    common()
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
    const { runEmbeddingMigration } = await import('@/lib/kb/embedding-migration')
    expect(await runEmbeddingMigration(3)).toEqual({ staged: 0, switched: false })
  })

  it('skips a workspace another worker holds the lease on, without touching its failure count', async () => {
    const { db, executed } = fakeDb({ leased: false })
    common()
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
    const { runEmbeddingMigration } = await import('@/lib/kb/embedding-migration')
    expect(await runEmbeddingMigration(3)).toEqual({ staged: 0, switched: false })
    expect(failuresIncremented(executed)).toBe(false)
    expect(leaseCleared(executed)).toBe(false)
  })

  it('a failing pass records the failure for backoff, releases the lease, and rethrows', async () => {
    const embedMany = vi.fn(async () => { throw new Error('provider rejected the key') })
    const { db, executed } = fakeDb({ leased: true, articleRows: [{ id: 1, question: 'q', answer: 'a' }] })
    common({ embedMany })
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
    const { runEmbeddingMigration } = await import('@/lib/kb/embedding-migration')
    await expect(runEmbeddingMigration(3)).rejects.toThrow('provider rejected the key')
    expect(failuresIncremented(executed)).toBe(true)
    expect(leaseCleared(executed)).toBe(true)
  })

  it('never re-embeds on the platform key for a workspace with no live subscription', async () => {
    const embedMany = vi.fn()
    const { db, executed } = fakeDb({ leased: true, articleRows: [{ id: 1, question: 'q', answer: 'a' }] })
    common({ tier: null, embedMany })
    vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => db }))
    const { runEmbeddingMigration } = await import('@/lib/kb/embedding-migration')
    expect(await runEmbeddingMigration(3)).toEqual({ staged: 0, switched: false })
    expect(embedMany).not.toHaveBeenCalled()
    expect(failuresIncremented(executed)).toBe(true)
    expect(leaseCleared(executed)).toBe(true)
  })

  it('renews the lease as it stages, so a long re-embed is not picked up twice', () => {
    const s = SRC()
    const stage = s.slice(s.indexOf('async function stageArticles'), s.indexOf('async function switchIfComplete'))
    expect(stage.match(/renewLease\(orgId\)/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
