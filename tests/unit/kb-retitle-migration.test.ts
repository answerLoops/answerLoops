import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The bookkeeping behind re-titling earlier page imports (lib/kb/retitle-imports.ts):
 * which URL sources still have bare section titles, and the per-workspace lease
 * the background pass holds while it runs.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const FILE = '0086_kb_retitle_imports.sql'

describe('migration 0086', () => {
  const sql = read(`drizzle/${FILE}`)
  const executable = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

  it('adds titles_version to kb_sources as 0 for every existing row, only if it is missing', () => {
    expect(executable).toMatch(/ALTER TABLE kb_sources ADD COLUMN IF NOT EXISTS titles_version INTEGER NOT NULL DEFAULT 0;/)
  })

  it('marks every non-URL source, and a URL source only when it was imported after the change and already has page titles', () => {
    expect(executable).toMatch(/UPDATE kb_sources s SET titles_version = 1\s+WHERE s\.titles_version = 0 AND \(\s*s\.file_type <> 'url'/)
    expect(executable).toMatch(/s\.created_at::timestamptz >= '2026-11-23T04:09:45Z'/)
    expect(executable).toMatch(/EXISTS \(SELECT 1 FROM kb_articles a WHERE a\.source_id = s\.id AND a\.org_id = s\.org_id AND a\.question LIKE '% › %'\)/)
  })

  it('makes 1 the default before the backfill, so a source created while the migration runs is never left at 0', () => {
    const update = executable.indexOf('UPDATE kb_sources s SET titles_version = 1')
    const setDefault = executable.indexOf('ALTER TABLE kb_sources ALTER COLUMN titles_version SET DEFAULT 1;')
    expect(setDefault).toBeGreaterThan(-1)
    expect(update).toBeGreaterThan(setDefault)
  })

  it('adds the workspace lease, attempt time and failure count, only if they are missing', () => {
    expect(executable).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS kb_retitle_lease_until timestamptz;/)
    expect(executable).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS kb_retitle_attempted_at timestamptz;/)
    expect(executable).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS kb_retitle_failures integer NOT NULL DEFAULT 0;/)
  })

  it('indexes only the URL sources still waiting, so finding them stays cheap', () => {
    expect(executable).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_kb_sources_retitle_pending ON kb_sources \(org_id\) WHERE file_type = 'url' AND titles_version = 0;/
    )
  })

  it('separates statements for the runner and deletes nothing', () => {
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n'))
      .filter((s) => s.trim())
    expect(statements).toHaveLength(7)
    expect(executable).not.toMatch(/\b(DROP|DELETE|TRUNCATE|RENAME)\b/i)
  })

  it('sorts after every earlier migration and has a unique prefix', () => {
    const files = fs.readdirSync(path.join(root, 'drizzle')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
    expect(files.filter((f) => f.startsWith('0086_'))).toEqual([FILE])
    expect(files.indexOf(FILE)).toBe(files.indexOf('0085_review_visitor_message.sql') + 1)
  })
})

describe('schema parity with migration 0086', () => {
  const schema = read('lib/db/schema.ts')
  // A table's declaration runs from its `export const` to the next one.
  const block = (name: string) => {
    const start = schema.indexOf(`export const ${name} = pgTable(`)
    return schema.slice(start, schema.indexOf('\nexport const ', start + 1))
  }

  it('declares titles_version on kb_sources, defaulting to 1 for new rows', () => {
    expect(block('kbSources')).toMatch(/titlesVersion: integer\('titles_version'\)\.notNull\(\)\.default\(1\)/)
  })

  it('declares the re-title lease columns on orgs like the re-embed job’s', () => {
    const orgs = block('orgs')
    expect(orgs).toMatch(/kbRetitleLeaseUntil: timestamp\('kb_retitle_lease_until', \{ withTimezone: true \}\)/)
    expect(orgs).toMatch(/kbRetitleAttemptedAt: timestamp\('kb_retitle_attempted_at', \{ withTimezone: true \}\)/)
    expect(orgs).toMatch(/kbRetitleFailures: integer\('kb_retitle_failures'\)\.notNull\(\)\.default\(0\)/)
  })
})
