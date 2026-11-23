import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { githubRepos } from '@/lib/db/schema'

/**
 * Infrastructure coverage for the docs folders an owner chose for a repo and
 * the result of its last files sync: migration 0087, the drizzle columns, and
 * the row mapper.
 */

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'drizzle')
const FILE = '0087_github_repo_doc_folders.sql'
const raw = fs.readFileSync(path.join(DIR, FILE), 'utf8')
const code = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')

describe(`${FILE}`, () => {
  const chunks = raw
    .split('--> statement-breakpoint')
    .map((c) => code(c).replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  it('adds both nullable columns idempotently', () => {
    expect(chunks).toEqual([
      'ALTER TABLE github_repos ADD COLUMN IF NOT EXISTS kb_paths TEXT[];',
      'ALTER TABLE github_repos ADD COLUMN IF NOT EXISTS kb_sync_result JSONB;',
    ])
    expect(code(raw)).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|RENAME)\b/i)
  })

  it('is the only 0087 and directly follows 0086', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files.filter((f) => f.startsWith('0087_'))).toEqual([FILE])
    const idx = files.indexOf(FILE)
    expect(files[idx - 1].startsWith('0086_')).toBe(true)
  })
})

describe('githubRepos drizzle columns', () => {
  it('declares kb_paths as a nullable text array and kb_sync_result as nullable jsonb', () => {
    const cols = Object.fromEntries(getTableConfig(githubRepos).columns.map((c) => [c.name, c]))
    expect(cols.kb_paths.notNull).toBe(false)
    expect(cols.kb_paths.getSQLType()).toBe('text[]')
    expect(cols.kb_sync_result.notNull).toBe(false)
    expect(cols.kb_sync_result.getSQLType()).toBe('jsonb')
  })
})

const rows = vi.hoisted(() => ({ value: [] as unknown[] }))
vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows.value }) }) }),
  }),
}))

describe('getRepos mapping', () => {
  const base = {
    id: 1, orgId: 2, installationId: 3, owner: 'acme', repo: 'docs', isPrivate: 0, monitoredEvents: 'both',
    kbEnabled: 1, kbLastSynced: null, kbSyncedCommit: null, kbChunkCount: 0, autoDeflectEnabled: 0, addedAt: '2026-11-23',
  }

  beforeEach(() => {
    rows.value = []
  })

  it('maps chosen folders and the last sync result', async () => {
    const result = { synced: 3, skippedForRoom: 0, failed: 0, tooLarge: 0, missingFolders: ['guide'] }
    rows.value = [{ ...base, kbPaths: ['docs'], kbSyncResult: result }]
    const { getRepos } = await import('@/lib/db/queries/github')
    const [repo] = await getRepos(2)
    expect(repo.kb_paths).toEqual(['docs'])
    expect(repo.kb_sync_result).toEqual(result)
  })

  it('maps missing values to null', async () => {
    rows.value = [{ ...base, kbPaths: null, kbSyncResult: null }]
    const { getRepos } = await import('@/lib/db/queries/github')
    const [repo] = await getRepos(2)
    expect(repo.kb_paths).toBeNull()
    expect(repo.kb_sync_result).toBeNull()
  })
})
