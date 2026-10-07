import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { productFeedback, productUpdates } from '@/lib/db/schema'
import { FEEDBACK_STATUSES } from '@/lib/product-feedback/validation'

// The runtime applies hand-written SQL migrations while queries use the
// drizzle schema, so the two can silently drift. Compare them directly.

const sql = fs.readFileSync(path.join(process.cwd(), 'drizzle/0046_product_feedback.sql'), 'utf-8')

function sqlColumns(table: string): Map<string, boolean> {
  const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`))
  expect(m, `table ${table} not found in migration`).toBeTruthy()
  const cols = new Map<string, boolean>()
  for (const raw of m![1].split('\n')) {
    const line = raw.replace(/--.*$/, '').trim().replace(/,$/, '')
    if (!line) continue
    const name = line.split(/\s+/)[0]
    cols.set(name, /NOT NULL|PRIMARY KEY/.test(line))
  }
  return cols
}

describe.each([
  ['product_feedback', productFeedback],
  ['product_updates', productUpdates],
])('%s: migration SQL matches the drizzle schema', (name, table) => {
  const cfg = getTableConfig(table as PgTable)

  it('has exactly the same column names', () => {
    expect([...sqlColumns(name).keys()].sort()).toEqual(cfg.columns.map((c) => c.name).sort())
  })

  it('agrees on NOT NULL for every column', () => {
    const cols = sqlColumns(name)
    for (const c of cfg.columns) {
      expect(cols.get(c.name), `${name}.${c.name} nullability`).toBe(c.notNull)
    }
  })

  it('creates every index the schema declares', () => {
    for (const idx of cfg.indexes) {
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS ${idx.config.name} ON ${name}`)
    }
  })
})

describe('status constraint', () => {
  it('allows exactly the statuses the app defines', () => {
    const m = sql.match(/CHECK \(status IN \(([^)]*)\)\)/)
    expect(m).toBeTruthy()
    const values = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    expect(values.sort()).toEqual([...FEEDBACK_STATUSES].sort())
  })

  it('schema default matches the SQL default', () => {
    expect(getTableConfig(productFeedback).columns.find((c) => c.name === 'status')!.default).toBe('pending')
  })
})
