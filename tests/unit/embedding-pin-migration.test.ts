import { describe, it, expect } from 'vitest'
import fs from 'fs'

// The pin and the re-embed staging columns. Existing rows were stamped with a
// constant model name regardless of the model actually used, so the migration
// aligns them with each workspace's pin before search starts filtering on it.

const sqlText = () => fs.readFileSync('drizzle/0052_embedding_model_pin.sql', 'utf-8')
const schema = () => fs.readFileSync('lib/db/schema.ts', 'utf-8')

describe('drizzle/0052_embedding_model_pin.sql', () => {
  it('adds the pin and staging columns idempotently', () => {
    const s = sqlText()
    for (const re of [
      /ALTER TABLE orgs ADD COLUMN IF NOT EXISTS embedding_model_in_use text/i,
      /ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS embedding_next text/i,
      /ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS embedding_vec_next vector\(1536\)/i,
      /ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS model_next text/i,
      /ALTER TABLE ticket_embeddings ADD COLUMN IF NOT EXISTS vector_next text/i,
      /ALTER TABLE ticket_embeddings ADD COLUMN IF NOT EXISTS model_next text/i,
    ]) expect(s).toMatch(re)
  })

  it('backfills the pin only where unset, from own embedding config, else the historical default', () => {
    const s = sqlText()
    expect(s).toMatch(/WHERE o\.embedding_model_in_use IS NULL/i)
    expect(s).toContain("'text-embedding-3-small'")
    expect(s).toMatch(/c\.embedding_base_url IS NOT NULL/i)
    expect(s).toMatch(/c\.embedding_api_key IS NOT NULL/i)
    expect(s).toMatch(/c\.chat_provider = 'openai' AND c\.chat_api_key IS NOT NULL/i)
  })

  it('restamps existing rows with the pin', () => {
    const s = sqlText()
    expect(s).toMatch(/UPDATE kb_articles a SET model = o\.embedding_model_in_use FROM orgs o WHERE a\.org_id = o\.id/i)
    expect(s).toMatch(/UPDATE ticket_embeddings te SET model = o\.embedding_model_in_use FROM tickets t JOIN orgs o ON o\.id = t\.org_id WHERE te\.ticket_id = t\.id/i)
  })
})

describe('lib/db/schema.ts', () => {
  it('declares the pin and staging columns', () => {
    const s = schema()
    expect(s).toMatch(/embeddingModelInUse:\s*text\('embedding_model_in_use'\)/)
    expect(s).toMatch(/embeddingNext:\s*text\('embedding_next'\)/)
    expect(s).toMatch(/embeddingVecNext:\s*vector\('embedding_vec_next', \{ dimensions: 1536 \}\)/)
    expect(s).toMatch(/modelNext:\s*text\('model_next'\)/)
    expect(s).toMatch(/vectorNext:\s*text\('vector_next'\)/)
  })
})

describe('drizzle/0053_embedding_migration_lease.sql', () => {
  // The re-embed job leases a workspace through a row (a session advisory
  // lock leaks across pooled connections) and backs off ones that keep failing.
  const lease = () => fs.readFileSync('drizzle/0053_embedding_migration_lease.sql', 'utf-8')

  it('adds the lease, last-attempt and failure-count columns to orgs idempotently', () => {
    const s = lease()
    expect(s).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS embedding_migration_lease_until timestamptz/i)
    expect(s).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS embedding_migration_attempted_at timestamptz/i)
    expect(s).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS embedding_migration_failures integer NOT NULL DEFAULT 0/i)
  })

  it('schema.ts declares them on orgs', () => {
    const s = schema()
    expect(s).toMatch(/embeddingMigrationLeaseUntil:\s*timestamp\('embedding_migration_lease_until', \{ withTimezone: true \}\)/)
    expect(s).toMatch(/embeddingMigrationAttemptedAt:\s*timestamp\('embedding_migration_attempted_at', \{ withTimezone: true \}\)/)
    expect(s).toMatch(/embeddingMigrationFailures:\s*integer\('embedding_migration_failures'\)\.notNull\(\)\.default\(0\)/)
  })
})
