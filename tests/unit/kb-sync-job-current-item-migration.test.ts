import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// current_item threads the title of the Notion page currently being embedded
// through to the UI, so a running sync shows "Syncing: <title> (N/M)" instead
// of a bare count. These assertions catch the migration or schema declaration
// silently drifting (e.g. a column rename that isn't mirrored in schema.ts,
// which would make every write via drizzle's sql`` silently target a
// nonexistent or wrong column at runtime with no compile-time error).

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

describe('drizzle/0041_kb_sync_job_current_item.sql', () => {
  const migrationPath = 'drizzle/0041_kb_sync_job_current_item.sql'

  it('exists and is non-empty', () => {
    const abs = path.join(ROOT, migrationPath)
    expect(fs.existsSync(abs)).toBe(true)
    const sql = read(migrationPath)
    expect(sql.trim().length).toBeGreaterThan(0)
  })

  it('adds a nullable current_item TEXT column to kb_sync_jobs, idempotently', () => {
    const sql = read(migrationPath)
    // Idempotent (IF NOT EXISTS) — migrations in this repo can be re-run
    // against a DB that already has the column (e.g. a redeploy).
    expect(sql).toMatch(/ALTER TABLE kb_sync_jobs\s+ADD COLUMN IF NOT EXISTS current_item TEXT/i)
    // Not NOT NULL — existing rows (and GitHub syncs, which never set it)
    // must remain valid without a backfill.
    expect(sql).not.toMatch(/current_item[^,]*NOT NULL/i)
  })
})

describe('lib/db/schema.ts — kbSyncJobs.currentItem', () => {
  it('declares currentItem mapped to the current_item column, inside the kbSyncJobs table', () => {
    const src = read('lib/db/schema.ts')
    const tableIdx = src.indexOf("export const kbSyncJobs = pgTable(")
    expect(tableIdx).toBeGreaterThan(-1)
    // Isolate just this table's column block so a currentItem field on some
    // unrelated table can't make this test pass by accident.
    const closeIdx = src.indexOf('\n)', tableIdx)
    const tableBody = src.slice(tableIdx, closeIdx === -1 ? undefined : closeIdx)
    expect(tableBody).toMatch(/currentItem:\s*text\('current_item'\)/)
    // Nullable in the drizzle definition too — no .notNull() on this field.
    const fieldIdx = tableBody.indexOf("currentItem:")
    const fieldLineEnd = tableBody.indexOf('\n', fieldIdx)
    const fieldLine = tableBody.slice(fieldIdx, fieldLineEnd === -1 ? undefined : fieldLineEnd)
    expect(fieldLine).not.toMatch(/\.notNull\(\)/)
  })
})
