import { randomUUID } from 'node:crypto'
import { getTableColumns } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { kbArticleEvents, kbArticles, kbSources, orgs } from '@/lib/db/schema'

/**
 * One synced repository file's sections against a real PostgreSQL with
 * pgvector: a file's sections and its record change together or not at all,
 * and saved resolutions near what changed are marked for review.
 */

const h = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb: h.getDb }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const url = process.env.TEST_ACTIVITY_DATABASE_URL
const schema = `srcfiles_${randomUUID().replaceAll('-', '')}`
const MODEL = 'text-embedding-3-small'
const vec = (n: number) => Array.from({ length: 1536 }, (_, i) => (i === 0 ? n : i === 1 ? 1 : 0))

describe.skipIf(!url)('synced repository files on PostgreSQL', () => {
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
    // As migration 0088 creates it: the upsert relies on the unique pair.
    await client.unsafe(`CREATE TABLE kb_source_files (
      id serial primary key, org_id integer NOT NULL, source_id integer NOT NULL, path text NOT NULL,
      blob_sha text NOT NULL, title text NOT NULL, chunk_count integer NOT NULL DEFAULT 0,
      processing_version integer NOT NULL, synced_at text NOT NULL DEFAULT (now()::text), UNIQUE (source_id, path))`)
  })

  afterAll(async () => {
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await client?.end()
    await admin?.end()
  })

  let sourceId: number

  beforeEach(async () => {
    await client`TRUNCATE orgs, kb_sources, kb_articles, kb_article_events, kb_source_files RESTART IDENTITY`
    await client`INSERT INTO orgs (id, name, embedding_model_in_use) VALUES (1, 'Acme', ${MODEL})`
    const [s] = await client`INSERT INTO kb_sources (org_id, filename, file_type, size_bytes, chunk_count, published)
      VALUES (1, 'acme/docs', 'github', 0, 0, 1) RETURNING id`
    sourceId = s.id
  })

  const section = (question: string, answer: string, n = 5) => ({ question, answer, embedding: vec(n), model: MODEL })
  const q = async () => import('@/lib/db/queries/kb-source-files')
  const sectionsOf = async (path: string) =>
    client`SELECT a.question, a.answer, a.source_file_id, a.published FROM kb_articles a
           JOIN kb_source_files f ON f.id = a.source_file_id WHERE f.path = ${path} ORDER BY a.id`
  const record = async (path: string) => (await client`SELECT * FROM kb_source_files WHERE path = ${path}`)[0]

  async function resolution(n: number) {
    const [row] = await client`INSERT INTO kb_articles (org_id, question, answer, embedding, embedding_vec, model, source_ticket_id, published, updated_at)
      VALUES (1, 'How do I sync?', 'Use Sync now.', ${JSON.stringify(vec(n))}, ${JSON.stringify(vec(n))}::vector, ${MODEL}, 42, 1, '2026-01-01')
      RETURNING id`
    return row.id as number
  }
  const flaggedAt = async (id: number) => (await client`SELECT docs_changed_at, docs_changed_source FROM kb_articles WHERE id = ${id}`)[0]

  const replace = async (over: Partial<Parameters<Awaited<ReturnType<typeof q>>['replaceFileSections']>[0]> = {}) =>
    (await q()).replaceFileSections({
      orgId: 1, sourceId, path: 'docs/a.md', blobSha: 'sha1', title: 'A', version: 1,
      sections: [section('A › One', 'First section body.'), section('A › Two', 'Second section body.')],
      published: 1, flag: null, ...over,
    })

  it('replace inserts sections and record atomically', async () => {
    const { fileId } = await replace()
    const rows = await sectionsOf('docs/a.md')
    expect(rows.map((r) => r.question)).toEqual(['A › One', 'A › Two'])
    expect(rows.every((r) => r.source_file_id === fileId && r.published === 1)).toBe(true)
    expect(await record('docs/a.md')).toMatchObject({ blob_sha: 'sha1', title: 'A', chunk_count: 2, processing_version: 1, source_id: sourceId, org_id: 1 })
    const events = await client`SELECT type, origin FROM kb_article_events ORDER BY id`
    expect(events).toEqual([{ type: 'created', origin: 'sync' }, { type: 'created', origin: 'sync' }])
    expect(await (await q()).listSourceFiles(sourceId, 1)).toEqual([{ id: fileId, path: 'docs/a.md', blobSha: 'sha1', processingVersion: 1, chunkCount: 2 }])
  })

  it('replace swaps old sections for new and keeps id stable', async () => {
    const first = await replace()
    const second = await replace({ blobSha: 'sha2', title: 'A2', version: 2, sections: [section('A2 › Only', 'Rewritten body text.')] })
    expect(second.fileId).toBe(first.fileId)
    expect((await sectionsOf('docs/a.md')).map((r) => r.question)).toEqual(['A2 › Only'])
    expect(await record('docs/a.md')).toMatchObject({ blob_sha: 'sha2', title: 'A2', chunk_count: 1, processing_version: 2 })
    expect((await client`SELECT count(*)::int AS n FROM kb_articles`)[0].n).toBe(1)
  })

  it('a throw inside replace leaves old sections and record untouched', async () => {
    await replace()
    const bad = { question: 'A › Bad', answer: 'Body.', embedding: [0.1, 0.2], model: MODEL }
    await expect(replace({ blobSha: 'sha2', sections: [section('A › New', 'New body.'), bad] })).rejects.toThrow()
    expect((await sectionsOf('docs/a.md')).map((r) => r.question)).toEqual(['A › One', 'A › Two'])
    expect((await record('docs/a.md')).blob_sha).toBe('sha1')
  })

  it('remove deletes record and its sections', async () => {
    const { fileId } = await replace()
    await replace({ path: 'docs/b.md' })
    const removed = await (await q()).removeSourceFile({ orgId: 1, fileId, flag: null })
    expect(removed).toBe(2)
    expect(await record('docs/a.md')).toBeUndefined()
    expect(await sectionsOf('docs/b.md')).toHaveLength(2)
    expect((await client`SELECT count(*)::int AS n FROM kb_articles WHERE source_file_id = ${fileId}`)[0].n).toBe(0)
  })

  it('remove only acts inside the given workspace', async () => {
    const { fileId } = await replace()
    expect(await (await q()).removeSourceFile({ orgId: 2, fileId, flag: null })).toBe(0)
    expect(await record('docs/a.md')).toBeDefined()
  })

  it('flags a resolution near an edited section', async () => {
    await replace()
    const r = await resolution(5)
    const budget = { remaining: 10 }
    const { flagged } = await replace({ blobSha: 'sha2', sections: [section('A › One', 'Edited first body.'), section('A › Two', 'Second section body.')], flag: { label: 'acme/docs', budget } })
    // The old and the new wording of the edited section both count.
    expect(flagged).toBe(2)
    expect(budget.remaining).toBe(8)
    expect((await flaggedAt(r)).docs_changed_source).toBe('acme/docs')
  })

  it('unchanged text flags nothing', async () => {
    await replace()
    const r = await resolution(5)
    const budget = { remaining: 10 }
    const { flagged } = await replace({ blobSha: 'sha2', flag: { label: 'acme/docs', budget } })
    expect(flagged).toBe(0)
    expect(budget.remaining).toBe(10)
    expect((await flaggedAt(r)).docs_changed_at).toBeNull()
  })

  it('stops flagging once the sync budget is used up', async () => {
    await replace()
    const r = await resolution(5)
    const { flagged } = await replace({ blobSha: 'sha2', sections: [section('A › One', 'Edited.')], flag: { label: 'acme/docs', budget: { remaining: 0 } } })
    expect(flagged).toBe(0)
    expect((await flaggedAt(r)).docs_changed_at).toBeNull()
  })

  it('refuses a source from another workspace', async () => {
    await expect(replace({ orgId: 2 })).rejects.toThrow()
    expect((await client`SELECT count(*)::int AS n FROM kb_articles`)[0].n).toBe(0)
    expect((await client`SELECT count(*)::int AS n FROM kb_source_files`)[0].n).toBe(0)
  })

  it('never takes over another workspace\'s file row', async () => {
    await replace()
    await client`INSERT INTO kb_sources (org_id, filename, file_type, size_bytes, chunk_count, published) VALUES (2, 'other', 'github', 0, 0, 1)`
    await client`UPDATE kb_sources SET org_id = 2 WHERE id = ${sourceId}`
    await expect(replace({ orgId: 2, blobSha: 'sha2' })).rejects.toThrow()
    expect((await record('docs/a.md')).blob_sha).toBe('sha1')
    expect(await sectionsOf('docs/a.md')).toHaveLength(2)
  })

  it('flags only as many sections as the budget allows', async () => {
    await replace()
    await resolution(5)
    const budget = { remaining: 1 }
    const { flagged } = await replace({ blobSha: 'sha2', sections: [section('A › One', 'Edited.'), section('A › Two', 'Second section body.')], flag: { label: 'acme/docs', budget } })
    expect(flagged).toBe(1)
    expect(budget.remaining).toBe(0)
  })

  it('keeps the budget when marking fails, and still replaces the file', async () => {
    await replace()
    await resolution(5)
    // Marking compares against the workspace's pinned model; a missing orgs
    // column makes that query fail inside its savepoint.
    await client`ALTER TABLE orgs RENAME COLUMN embedding_model_in_use TO pinned_model_tmp`
    try {
      const budget = { remaining: 10 }
      const { flagged } = await replace({ blobSha: 'sha2', sections: [section('A › One', 'Edited.')], flag: { label: 'acme/docs', budget } })
      expect(flagged).toBe(0)
      expect(budget.remaining).toBe(10)
      expect((await record('docs/a.md')).blob_sha).toBe('sha2')
      expect((await sectionsOf('docs/a.md')).map((r) => r.question)).toEqual(['A › One'])
    } finally {
      await client`ALTER TABLE orgs RENAME COLUMN pinned_model_tmp TO embedding_model_in_use`
    }
  })

  it('a write whose job was taken over rolls back completely', async () => {
    await replace()
    const lost = async () => { throw new Error('lease lost') }
    await expect(replace({ blobSha: 'sha2', sections: [section('A › New', 'New body.')], guard: lost })).rejects.toThrow('lease lost')
    expect((await record('docs/a.md')).blob_sha).toBe('sha1')
    const { fileId } = await replace({ path: 'docs/b.md' })
    await expect((await q()).removeSourceFile({ orgId: 1, fileId, flag: null, guard: lost })).rejects.toThrow('lease lost')
    expect(await record('docs/b.md')).toBeDefined()
  })

  it('removing a file flags resolutions near its sections', async () => {
    const { fileId } = await replace()
    const r = await resolution(5)
    await (await q()).removeSourceFile({ orgId: 1, fileId, flag: { label: 'acme/docs', budget: { remaining: 10 } } })
    expect((await flaggedAt(r)).docs_changed_source).toBe('acme/docs')
  })
})
