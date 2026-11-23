import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { kbArticles, kbSourceFiles } from '@/lib/db/schema'
import { DOCS_PROCESSING_VERSION } from '@/lib/ingest/docs-file'

/**
 * Infrastructure coverage for recording which repository file each synced
 * section came from: migration 0088, the drizzle table and column, and the
 * processing version stored per file.
 */

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'drizzle')
const FILE = '0088_kb_source_files.sql'
const raw = fs.readFileSync(path.join(DIR, FILE), 'utf8')
const code = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
const flat = code.replace(/\s+/g, ' ')

describe(`${FILE}`, () => {
  it('creates the file records table idempotently, with both cascades and one row per path', () => {
    expect(flat).toMatch(/CREATE TABLE IF NOT EXISTS kb_source_files/i)
    expect(flat).toMatch(/org_id INTEGER NOT NULL REFERENCES orgs\(id\) ON DELETE CASCADE/i)
    expect(flat).toMatch(/source_id INTEGER NOT NULL REFERENCES kb_sources\(id\) ON DELETE CASCADE/i)
    expect(flat).toMatch(/UNIQUE \(source_id, path\)/i)
    expect(flat).toMatch(/CREATE INDEX IF NOT EXISTS idx_kb_source_files_org ON kb_source_files \(org_id\)/i)
  })

  it('links each section to its file, removed with the file', () => {
    expect(flat).toMatch(/ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS source_file_id INTEGER REFERENCES kb_source_files\(id\) ON DELETE CASCADE/i)
    expect(flat).toMatch(/CREATE INDEX IF NOT EXISTS idx_kb_articles_source_file ON kb_articles \(source_file_id\)/i)
  })

  it('is non-destructive and every statement is separated for the runner', () => {
    expect(code.replace(/ON DELETE CASCADE/gi, '')).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|RENAME)\b/i)
    const statements = raw.split('--> statement-breakpoint').map((c) => c.trim()).filter(Boolean)
    expect(statements).toHaveLength(5)
  })

  it('is the only 0088 and directly follows 0087', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files.filter((f) => f.startsWith('0088_'))).toEqual([FILE])
    expect(files[files.indexOf(FILE) - 1].startsWith('0087_')).toBe(true)
  })
})

describe('drizzle schema', () => {
  it('exports kb_source_files with the expected columns', () => {
    const cfg = getTableConfig(kbSourceFiles)
    expect(cfg.name).toBe('kb_source_files')
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]))
    for (const name of ['org_id', 'source_id', 'path', 'blob_sha', 'title', 'chunk_count', 'processing_version', 'synced_at']) {
      expect(cols[name]?.notNull, name).toBe(true)
    }
  })

  it('adds a nullable source_file_id to kb_articles', () => {
    const col = getTableConfig(kbArticles).columns.find((c) => c.name === 'source_file_id')
    expect(col?.notNull).toBe(false)
  })
})

describe('DOCS_PROCESSING_VERSION', () => {
  it('starts at 1', () => {
    expect(DOCS_PROCESSING_VERSION).toBe(1)
  })
})
