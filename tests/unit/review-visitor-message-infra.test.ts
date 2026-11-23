import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The column that keeps a visitor's own words beside a rewritten follow-up on a
 * review item: its migration, the matching schema declaration, and that the
 * migration runner picks the file up in order. File-system assertions only; no
 * database needed. The route, query and purge behavior are covered in
 * widget-chat-followup-search, kb-review-queries and kb-review-capture.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const FILE = '0085_review_visitor_message.sql'

describe('migration 0085', () => {
  const sql = read(`drizzle/${FILE}`)
  const executable = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()

  it('exists and has a statement to run', () => {
    expect(executable.length).toBeGreaterThan(0)
  })

  it('adds visitor_message to kb_review_items only if it is missing, so applying it twice is harmless', () => {
    expect(executable).toMatch(/^ALTER TABLE kb_review_items ADD COLUMN IF NOT EXISTS visitor_message TEXT;$/)
  })

  it('leaves the column nullable with no default, so existing rows are untouched', () => {
    expect(executable).not.toMatch(/NOT NULL/i)
    expect(executable).not.toMatch(/DEFAULT/i)
  })

  it('is a single statement and changes nothing else', () => {
    expect(executable.match(/;/g)).toHaveLength(1)
    expect(sql).not.toContain('--> statement-breakpoint')
    expect(executable).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME|CREATE)\b/i)
  })
})

describe('migration ordering', () => {
  const numbered = () =>
    fs
      .readdirSync(path.join(root, 'drizzle'))
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort()

  it('comes right after the answer flags migration', () => {
    const files = numbered()
    expect(files.indexOf(FILE)).toBe(files.indexOf('0084_widget_answer_flags.sql') + 1)
  })

  it('has a unique 0085 prefix, so the sort order is deterministic', () => {
    expect(numbered().filter((f) => f.startsWith('0085_'))).toEqual([FILE])
  })

  it('is picked up by the runner, which applies every drizzle/*.sql file sorted by name', () => {
    const migrate = read('lib/db/migrate.ts')
    expect(migrate).toMatch(/path\.resolve\(process\.cwd\(\), 'drizzle'\)/)
    expect(migrate).toMatch(/\.filter\(\(f\) => f\.endsWith\('\.sql'\)\)\s*\.sort\(\)/)
    // The same selection the runner makes places 0085 after 0084.
    const runnerOrder = fs.readdirSync(path.join(root, 'drizzle')).filter((f) => f.endsWith('.sql')).sort()
    expect(runnerOrder).toContain(FILE)
    expect(runnerOrder.indexOf(FILE)).toBeGreaterThan(runnerOrder.indexOf('0084_widget_answer_flags.sql'))
  })
})

describe('schema parity', () => {
  const schema = read('lib/db/schema.ts')
  const start = schema.indexOf("pgTable(\n  'kb_review_items'")
  const block = schema.slice(start, schema.indexOf('\nexport const ', start))

  it('declares visitor_message on kbReviewItems as a nullable text column', () => {
    expect(start).toBeGreaterThan(-1)
    expect(block).toMatch(/visitorMessage: text\('visitor_message'\),/)
    expect(block).not.toMatch(/visitorMessage: text\('visitor_message'\)\.(notNull|default)/)
  })

  it('declares it nowhere else, so the column belongs to the review table only', () => {
    expect(schema.match(/'visitor_message'/g)).toHaveLength(1)
  })
})
