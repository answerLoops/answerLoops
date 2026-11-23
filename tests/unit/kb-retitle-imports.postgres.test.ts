import { randomUUID } from 'node:crypto'
import { getTableColumns } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiConfigs, kbArticleEvents, kbArticles, kbSources, orgs } from '@/lib/db/schema'
import { contentHash } from '@/lib/kb/revision'

/**
 * The re-title pass against a real PostgreSQL with pgvector: sections from
 * pages imported before titles carried the page get "pricing › Pro" and a new
 * vector, without touching anything a person changed, and without the pass
 * ever overwriting an edit made while it ran.
 */

const h = vi.hoisted(() => ({
  getDb: vi.fn(),
  tier: 'plan' as 'plan' | 'trial' | null,
  ownConfig: false,
  embedMany: vi.fn(),
}))
vi.mock('@/lib/db/drizzle', () => ({ getDb: h.getDb }))
vi.mock('@/lib/billing/platform-ai-budget', () => ({ getBillingTier: async () => h.tier }))
vi.mock('@/lib/db/queries/ai-config', () => ({
  getOrgAIConfig: async () => (h.ownConfig ? { embedding_api_key: 'set', embedding_model: 'text-embedding-3-small' } : null),
}))
vi.mock('@/lib/ai/embedding-pin', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/embedding-pin')>()),
  embeddingTargetFor: () => ({ modelId: 'text-embedding-3-small', own: h.ownConfig }),
}))
vi.mock('@/lib/ai/platform-models', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/platform-models')>()),
  getPlatformModel: () => 'text-embedding-3-small',
  platformEmbedding: (id: string) => ({ modelId: id }),
}))
vi.mock('@/lib/ai/models', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/models')>()),
  ownEmbeddingModel: (_cfg: unknown, id: string) => ({ modelId: id }),
}))
vi.mock('@/lib/ai/metering', () => ({
  meterLanguageModel: () => { throw new Error('the re-title pass must not meter') },
  meterEmbeddingModel: () => { throw new Error('the re-title pass must not meter') },
}))
vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), embedMany: h.embedMany }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const url = process.env.TEST_ACTIVITY_DATABASE_URL
const schema = `retitle_${randomUUID().replaceAll('-', '')}`
const OLD = '2026-11-01 10:00:00+00'
const vec = (n: number) => Array.from({ length: 1536 }, (_, i) => (i === 0 ? n : 0))

describe.skipIf(!url)('re-titling earlier page imports on PostgreSQL', () => {
  let admin: postgres.Sql
  let client: postgres.Sql

  const createTable = async (table: PgTable, name: string) => {
    const columns = Object.values(getTableColumns(table)).map((c) =>
      c.name === 'id' ? 'id serial primary key' : `"${c.name}" ${c.getSQLType()}`
    )
    await client.unsafe(`CREATE TABLE ${name} (${columns.join(', ')})`)
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`CREATE EXTENSION IF NOT EXISTS vector`
    await admin`CREATE SCHEMA ${admin(schema)}`
    client = postgres(url!, {
      prepare: false,
      onnotice: () => {},
      connection: { search_path: `${schema},public,pg_catalog`, statement_timeout: 8_000 },
    })
    h.getDb.mockReturnValue(drizzle(client))
    await createTable(orgs, 'orgs')
    await createTable(kbSources, 'kb_sources')
    await createTable(kbArticles, 'kb_articles')
    await createTable(kbArticleEvents, 'kb_article_events')
    await createTable(aiConfigs, 'ai_configs')
  })

  afterAll(async () => {
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await client?.end()
    await admin?.end()
  })

  beforeEach(async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    h.tier = 'plan'
    h.ownConfig = false
    h.embedMany.mockReset()
    h.embedMany.mockImplementation(async ({ values }: { values: string[] }) => ({ embeddings: values.map((_, i) => vec(i + 2)) }))
    await client`TRUNCATE orgs, kb_sources, kb_articles, kb_article_events, ai_configs RESTART IDENTITY`
    await client`INSERT INTO orgs (id, name, embedding_model_in_use, kb_retitle_failures, embedding_migration_failures)
                 VALUES (1, 'Acme', 'text-embedding-3-small', 0, 0)`
  })

  async function source(filename: string, opts: { version?: number; createdAt?: string } = {}) {
    const [row] = await client`INSERT INTO kb_sources (org_id, filename, file_type, size_bytes, chunk_count, published, titles_version, created_at, updated_at)
      VALUES (1, ${filename}, 'url', 100, 1, 1, ${opts.version ?? 0}, ${opts.createdAt ?? OLD}, ${OLD}) RETURNING id`
    return row.id as number
  }

  async function article(sourceId: number, question: string, answer: string, opts: { verified?: boolean; staleVerified?: boolean; model?: string } = {}) {
    const verifiedHash = opts.verified ? contentHash(question, answer) : opts.staleVerified ? contentHash('older', answer) : null
    const [row] = await client`INSERT INTO kb_articles (org_id, question, answer, embedding, embedding_vec, model, source_id, published, verified_at, verified_content_hash, created_at, updated_at)
      VALUES (1, ${question}, ${answer}, ${JSON.stringify(vec(1))}, ${JSON.stringify(vec(1))}::vector, ${opts.model ?? 'text-embedding-3-small'},
              ${sourceId}, 1, ${verifiedHash ? OLD : null}, ${verifiedHash}, ${OLD}, ${OLD}) RETURNING id`
    return row.id as number
  }

  const articleRow = async (id: number) => (await client`SELECT * FROM kb_articles WHERE id = ${id}`)[0]
  const sourceVersion = async (id: number) => (await client`SELECT titles_version FROM kb_sources WHERE id = ${id}`)[0].titles_version
  const failures = async () => (await client`SELECT kb_retitle_failures FROM orgs WHERE id = 1`)[0].kb_retitle_failures
  const run = async (opts: { mode: 'scheduled' | 'owner'; maxSources?: number }) =>
    (await import('@/lib/kb/retitle-imports')).runRetitlePass(1, opts)

  it('puts the page in front of bare headings, re-embeds them, records the change and marks the page done', async () => {
    const s = await source('https://answerloops.com/pricing')
    const pro = await article(s, 'Pro', '$49 a month.')
    const result = await run({ mode: 'scheduled' })
    expect(result).toMatchObject({ retitled: 1, sourcesDone: 1, remainingSources: 0 })
    const row = await articleRow(pro)
    expect(row.question).toBe('pricing › Pro')
    expect(row.answer).toBe('$49 a month.')
    expect(row.model).toBe('text-embedding-3-small')
    expect(JSON.parse(row.embedding)[0]).toBe(2)
    expect(h.embedMany).toHaveBeenCalledWith(expect.objectContaining({ values: ['pricing › Pro\n\n$49 a month.'] }))
    const events = await client`SELECT type, origin, content_hash FROM kb_article_events WHERE article_id = ${pro}`
    expect(events).toEqual([{ type: 'edited', origin: 'import', content_hash: contentHash('pricing › Pro', '$49 a month.') }])
    expect(await sourceVersion(s)).toBe(1)
    expect(await failures()).toBe(0)
  })

  it('leaves a heading that already is the page title, and still marks the page done', async () => {
    const s = await source('https://x.com/pricing')
    const a = await article(s, 'Pricing', 'Plans start at $49.')
    await run({ mode: 'scheduled' })
    expect((await articleRow(a)).question).toBe('Pricing')
    expect(h.embedMany).not.toHaveBeenCalled()
    expect(await sourceVersion(s)).toBe(1)
  })

  it('never touches a title a person edited, but marks the page done so it is not picked up again', async () => {
    const s = await source('https://x.com/pricing')
    const edited = await article(s, 'Our Pro plan', '$49 a month.')
    await client`INSERT INTO kb_article_events (org_id, article_id, type, origin, created_at) VALUES (1, ${edited}, 'edited', 'manual', ${OLD})`
    await run({ mode: 'scheduled' })
    expect((await articleRow(edited)).question).toBe('Our Pro plan')
    expect(await sourceVersion(s)).toBe(1)
    expect(await (await import('@/lib/kb/retitle-imports')).listRetitleCandidates()).toEqual([])
  })

  it('keeps a verified article verified, and leaves an already out-of-date verification out of date', async () => {
    const s = await source('https://x.com/pricing')
    const verified = await article(s, 'Pro', '$49 a month.', { verified: true })
    const stale = await article(s, 'Team', '$149 a month.', { staleVerified: true })
    await run({ mode: 'scheduled' })
    expect((await articleRow(verified)).verified_content_hash).toBe(contentHash('pricing › Pro', '$49 a month.'))
    expect((await articleRow(stale)).verified_content_hash).toBe(contentHash('older', '$149 a month.'))
  })

  it('never overwrites an edit made while the pass was running', async () => {
    const s = await source('https://x.com/pricing')
    const a = await article(s, 'Pro', '$49 a month.')
    // Embedding runs after the pass has read the article and before it writes:
    // the moment a person's edit could land.
    h.embedMany.mockImplementation(async ({ values }: { values: string[] }) => {
      await client`UPDATE kb_articles SET question = 'Pro plan (edited)' WHERE id = ${a}`
      return { embeddings: values.map(() => vec(2)) }
    })
    const result = await run({ mode: 'scheduled' })
    expect((await articleRow(a)).question).toBe('Pro plan (edited)')
    expect(result.retitled).toBe(0)
    expect(await client`SELECT 1 FROM kb_article_events WHERE article_id = ${a}`).toHaveLength(0)
  })

  it('writes nothing for a page when embedding fails, and backs the workspace off', async () => {
    const s = await source('https://x.com/pricing')
    const a = await article(s, 'Pro', '$49 a month.')
    h.embedMany.mockRejectedValue(new Error('provider down'))
    await expect(run({ mode: 'scheduled' })).rejects.toThrow('provider down')
    expect((await articleRow(a)).question).toBe('Pro')
    expect(await sourceVersion(s)).toBe(0)
    expect(await failures()).toBe(1)
    const lease = await client`SELECT kb_retitle_lease_until FROM orgs WHERE id = 1`
    expect(lease[0].kb_retitle_lease_until).toBeNull()
  })

  it('refuses vectors that do not fit the knowledge-base column before writing anything', async () => {
    const s = await source('https://x.com/pricing')
    const a = await article(s, 'Pro', '$49 a month.')
    h.embedMany.mockResolvedValue({ embeddings: [[1, 2, 3]] })
    await expect(run({ mode: 'scheduled' })).rejects.toThrow(/1536/)
    expect((await articleRow(a)).question).toBe('Pro')
    expect(await sourceVersion(s)).toBe(0)
  })

  it('skips, without counting a failure, a scheduled run for a workspace with no live subscription', async () => {
    const s = await source('https://x.com/pricing')
    await article(s, 'Pro', '$49 a month.')
    h.tier = null
    expect(await run({ mode: 'scheduled' })).toMatchObject({ skipped: 'not-eligible', retitled: 0, remainingSources: 1 })
    expect(await failures()).toBe(0)
    expect(h.embedMany).not.toHaveBeenCalled()
  })

  it('records the attempt on a skipped workspace, so it rotates behind others instead of staying first in line', async () => {
    await source('https://x.com/pricing')
    h.tier = null
    await run({ mode: 'scheduled' })
    const [org] = await client`SELECT kb_retitle_attempted_at, kb_retitle_lease_until FROM orgs WHERE id = 1`
    expect(org.kb_retitle_attempted_at).not.toBeNull()
    expect(org.kb_retitle_lease_until).toBeNull()
  })

  it('stops without marking a page done when a model switch starts partway through', async () => {
    const s = await source('https://x.com/pricing')
    const a = await article(s, 'Pro', '$49 a month.')
    // The re-embed job takes its lease after the pass checked, before it writes.
    h.embedMany.mockImplementation(async ({ values }: { values: string[] }) => {
      await client`UPDATE orgs SET embedding_migration_lease_until = now() + interval '5 minutes' WHERE id = 1`
      return { embeddings: values.map(() => vec(2)) }
    })
    expect(await run({ mode: 'scheduled' })).toMatchObject({ skipped: 'migrating', retitled: 0, remainingSources: 1 })
    expect((await articleRow(a)).question).toBe('Pro')
    expect(await sourceVersion(s)).toBe(0)
    expect(await failures()).toBe(0)
  })

  it('leaves a workspace on its own key to its owner, and lets the owner run it', async () => {
    const s = await source('https://x.com/pricing')
    await article(s, 'Pro', '$49 a month.')
    h.ownConfig = true
    expect(await run({ mode: 'scheduled' })).toMatchObject({ skipped: 'not-eligible' })
    expect(await run({ mode: 'owner' })).toMatchObject({ retitled: 1, remainingSources: 0 })
  })

  it('does not let the owner action run on the platform model', async () => {
    const s = await source('https://x.com/pricing')
    await article(s, 'Pro', '$49 a month.')
    expect(await run({ mode: 'owner' })).toMatchObject({ skipped: 'not-eligible', remainingSources: 1 })
  })

  it('waits while the workspace is moving to another embedding model', async () => {
    const s = await source('https://x.com/pricing')
    await article(s, 'Pro', '$49 a month.', { model: 'text-embedding-ada-002' })
    expect(await run({ mode: 'scheduled' })).toMatchObject({ skipped: 'migrating', retitled: 0 })
    expect(await failures()).toBe(0)
  })

  it('handles at most maxSources pages per pass, oldest first, and reports what is left', async () => {
    const first = await source('https://x.com/a')
    const second = await source('https://x.com/b')
    const third = await source('https://x.com/c')
    for (const s of [first, second, third]) await article(s, 'Intro', 'Some text here.')
    expect(await run({ mode: 'scheduled', maxSources: 2 })).toMatchObject({ sourcesDone: 2, remainingSources: 1 })
    expect([await sourceVersion(first), await sourceVersion(second), await sourceVersion(third)]).toEqual([1, 1, 0])
  })

  it('never picks up a page imported after titles carried the page, or one already done', async () => {
    const done = await source('https://x.com/a', { version: 1 })
    const a = await article(done, 'Intro', 'Some text here.')
    expect(await run({ mode: 'scheduled' })).toMatchObject({ retitled: 0, remainingSources: 0 })
    expect((await articleRow(a)).question).toBe('Intro')
  })

  it('lists workspaces with pages waiting, skipping one whose lease is held or that is backing off', async () => {
    await source('https://x.com/a')
    const { listRetitleCandidates } = await import('@/lib/kb/retitle-imports')
    expect(await listRetitleCandidates()).toEqual([1])
    await client`UPDATE orgs SET kb_retitle_lease_until = now() + interval '5 minutes' WHERE id = 1`
    expect(await listRetitleCandidates()).toEqual([])
    await client`UPDATE orgs SET kb_retitle_lease_until = NULL, kb_retitle_failures = 3, kb_retitle_attempted_at = now() WHERE id = 1`
    expect(await listRetitleCandidates()).toEqual([])
  })

  it('leaves a workspace with its own embedding key out of the scheduled sweep', async () => {
    await source('https://x.com/a')
    await client`INSERT INTO ai_configs (org_id, embedding_api_key) VALUES (1, 'stored-key-placeholder')`
    expect(await (await import('@/lib/kb/retitle-imports')).listRetitleCandidates()).toEqual([])
  })

  it('the migration marks only pages that already have page titles, wherever and whenever the upgrade runs', async () => {
    const { readFile } = await import('node:fs/promises')
    const AFTER = '2026-11-24 10:00:00+00'
    const oldPage = await source('https://x.com/old')
    await article(oldPage, 'Pro', '$49 a month.')
    const titled = await source('https://x.com/new', { createdAt: AFTER })
    await article(titled, 'Pricing › Pro', '$49 a month.')
    // Imported after the cutoff by an install still on the old code (self-hosted, upgraded later).
    const lateBare = await source('https://x.com/late', { createdAt: AFTER })
    await article(lateBare, 'Pro', '$49 a month.')
    const [upload] = await client`INSERT INTO kb_sources (org_id, filename, file_type, size_bytes, chunk_count, published, titles_version, created_at, updated_at)
      VALUES (1, 'guide.md', 'md', 10, 1, 1, 0, ${OLD}, ${OLD}) RETURNING id`
    const sqlText = await readFile('drizzle/0086_kb_retitle_imports.sql', 'utf8')
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const body = statement.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim()
      if (body) await client.unsafe(body)
    }
    expect(await sourceVersion(oldPage)).toBe(0)
    expect(await sourceVersion(titled)).toBe(1)
    expect(await sourceVersion(lateBare)).toBe(0)
    expect(await sourceVersion(upload.id)).toBe(1)
  })

  it('reports status for the owner action', async () => {
    await source('https://x.com/a')
    await source('https://x.com/b')
    const { retitleStatus } = await import('@/lib/kb/retitle-imports')
    expect(await retitleStatus(1)).toEqual({ eligibleForOwnerRun: false, remainingSources: 2 })
    h.ownConfig = true
    expect(await retitleStatus(1)).toEqual({ eligibleForOwnerRun: true, remainingSources: 2 })
  })
})
