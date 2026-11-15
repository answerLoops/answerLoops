import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Pins migration 0076, which drops the single-column feedback_id index that is
// redundant with the unique constraint's index. File-system assertions only.

const ROOT = process.cwd()
const DRIZZLE = path.join(ROOT, 'drizzle')
const INDEX = 'idx_product_feedback_votes_feedback'
const MIGRATION = '0076_drop_redundant_feedback_votes_index.sql'

const read = (rel: string) => {
  const abs = path.join(ROOT, rel)
  expect(fs.existsSync(abs), `File not found: ${rel}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}
const stripComments = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim()

describe('migration 0076 numbering', () => {
  const files = fs
    .readdirSync(DRIZZLE)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()

  it('exists', () => {
    expect(files).toContain(MIGRATION)
  })

  it('has a unique 0076 prefix', () => {
    expect(files.filter((f) => f.startsWith('0076_'))).toEqual([MIGRATION])
  })

  it('sorts directly after 0075', () => {
    const i = files.indexOf(MIGRATION)
    expect(i).toBeGreaterThan(0)
    expect(files[i - 1].startsWith('0075_')).toBe(true)
  })
})

describe('migration 0076 body', () => {
  const statements = stripComments(read(`drizzle/${MIGRATION}`))
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  it('is exactly one statement', () => {
    expect(statements).toHaveLength(1)
  })

  it('is DROP INDEX IF EXISTS for the redundant index', () => {
    expect(statements[0].replace(/\s+/g, ' ')).toBe(`DROP INDEX IF EXISTS ${INDEX}`)
  })

  it('does not use CONCURRENTLY or statement breakpoints', () => {
    const raw = read(`drizzle/${MIGRATION}`)
    expect(raw).not.toMatch(/CONCURRENTLY/i)
    expect(raw).not.toContain('--> statement-breakpoint')
  })

  it('contains nothing else destructive', () => {
    const sql = statements[0]
    expect(sql).not.toMatch(/\b(DROP\s+(TABLE|CONSTRAINT|TRIGGER|COLUMN)|TRUNCATE|DELETE|ALTER)\b/i)
    expect(sql).not.toMatch(/product_feedback_votes_unique/)
  })
})

describe('migration 0072 is left untouched', () => {
  const sql = read('drizzle/0072_product_feedback_votes.sql').replace(/\s+/g, ' ')

  it('still creates the index that 0076 drops', () => {
    expect(sql).toContain(
      `CREATE INDEX IF NOT EXISTS ${INDEX} ON product_feedback_votes (feedback_id)`
    )
  })

  it('still declares the unique constraint', () => {
    expect(sql).toContain('CONSTRAINT product_feedback_votes_unique UNIQUE (feedback_id, user_id)')
  })
})

describe('lib/db/schema.ts after the drop', () => {
  const schema = read('lib/db/schema.ts')

  it('no longer declares the dropped index', () => {
    expect(schema).not.toContain(INDEX)
  })

  it('still declares the unique constraint on (feedbackId, userId)', () => {
    expect(schema).toMatch(
      /unique\('product_feedback_votes_unique'\)\.on\(\s*t\.feedbackId,\s*t\.userId\s*\)/
    )
  })
})
