import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'

/**
 * Infrastructure coverage for the widget_leads.question column:
 *   drizzle/0071_widget_leads_question.sql
 *   lib/db/schema.ts            (widgetLeads.question)
 *
 * The product-behavior half (the route accepting, capping, and passing
 * through a question; the query layer storing it) is covered separately by
 * tests/unit/widget-lead-route-question.test.ts and
 * tests/unit/widget-deleted-org-and-lead-dedupe.test.ts; this file is the
 * plumbing underneath it, same split as widget-lead-capture-infra.test.ts
 * follows for the lead-capture-mode column.
 */

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0071_widget_leads_question.sql'
const COLUMN = 'question'

function readFileAt(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const readMigration = () => readFileAt(path.join('drizzle', MIGRATION))

/** Migration text with `-- ...` comments stripped, so prose can't accidentally satisfy a SQL assertion. */
const migrationSql = () => readMigration().replace(/--[^\n]*/g, '')

describe(`drizzle/${MIGRATION}`, () => {
  it('exists and is non-empty', () => {
    expect(readMigration().trim().length).toBeGreaterThan(0)
    expect(migrationSql().trim().length).toBeGreaterThan(0)
  })

  it('adds the column to widget_leads as a nullable TEXT column', () => {
    expect(migrationSql()).toMatch(
      new RegExp(`ALTER TABLE\\s+widget_leads\\s+ADD COLUMN IF NOT EXISTS\\s+${COLUMN}\\s+TEXT`, 'i')
    )
    // Deliberately nullable, no DEFAULT and no NOT NULL — an up-front-gate
    // lead is collected before any question exists, so it has none, and
    // every lead written before this column existed has none either.
    expect(migrationSql()).not.toMatch(/question\s+TEXT\s+NOT\s+NULL/i)
    expect(migrationSql()).not.toMatch(/DEFAULT/i)
  })

  it('is idempotent via IF NOT EXISTS, since the runner replays a whole file after a partial failure', () => {
    const statements = migrationSql()
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(statements.length).toBe(1)
    for (const stmt of statements) {
      expect(stmt, stmt).toMatch(/IF NOT EXISTS/i)
    }
  })

  it('touches only the widget_leads table', () => {
    const tables = [...migrationSql().matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_]+)/gi)].map((m) => m[1])
    expect(tables).toEqual(['widget_leads'])
    expect(migrationSql()).not.toMatch(/\b(DROP|CREATE TABLE|TRUNCATE|UPDATE|DELETE)\b/i)
  })

  it('has a unique numeric prefix among drizzle/*.sql, so ordering is deterministic', () => {
    const prefix = MIGRATION.slice(0, 4)
    const clashes = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql') && f.startsWith(prefix))
    expect(clashes).toEqual([MIGRATION])
  })

  it('is discovered by the migration runner glob and sorts after every earlier migration', () => {
    const files = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(files).toContain(MIGRATION)
    const idx = files.indexOf(MIGRATION)
    expect(files.slice(0, idx).every((f) => f < MIGRATION)).toBe(true)

    const leadsMigration = files.find((f) =>
      fs.readFileSync(path.join(DRIZZLE_DIR, f), 'utf-8').match(/CREATE TABLE (IF NOT EXISTS )?"?widget_leads"?/i)
    )
    expect(leadsMigration, 'no migration creates the widget_leads table').toBeDefined()
    expect(leadsMigration! < MIGRATION).toBe(true)
  })

  it('is hand-written, so it must not be registered in the drizzle journal', () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf-8')
    ) as { entries: { tag: string }[] }
    expect(journal.entries.map((e) => e.tag)).not.toContain(MIGRATION.replace('.sql', ''))
  })
})

describe('lib/db/schema: widgetLeads.question matches the migration', () => {
  it('declares a nullable text column with no default', async () => {
    const { widgetLeads } = await import('@/lib/db/schema')
    const col = getTableConfig(widgetLeads).columns.find((c) => c.name === COLUMN)
    expect(col, `${COLUMN} missing from the Drizzle widgetLeads table`).toBeDefined()
    expect(col!.getSQLType()).toBe('text')
    expect(col!.notNull).toBe(false)
    expect(col!.hasDefault).toBe(false)
  })

  it('is reachable under the camelCase name the query layer uses', async () => {
    const { widgetLeads } = await import('@/lib/db/schema')
    expect(widgetLeads.question).toBeDefined()
    expect(widgetLeads.question.name).toBe(COLUMN)
  })

  it('adds no index or constraint the migration does not create', async () => {
    const { widgetLeads } = await import('@/lib/db/schema')
    const cfg = getTableConfig(widgetLeads)
    const touching = [
      ...cfg.indexes.filter((i) => i.config.columns.some((c) => (c as { name?: string }).name === COLUMN)),
      ...cfg.uniqueConstraints.filter((u) => u.columns.some((c) => c.name === COLUMN)),
    ]
    expect(touching).toEqual([])
  })
})
