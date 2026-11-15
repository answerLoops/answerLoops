import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { productFeedbackVotes, productFeedback, users, orgs } from '@/lib/db/schema'

// How 0072 behaves under lib/db/migrate.ts, which product-feedback-votes-infra
// does not look at. The runner sorts drizzle/*.sql by name, splits each file on
// "--> statement-breakpoint", runs every chunk as ONE db.execute and tolerates
// only "already exists" errors per chunk. 0072 has no breakpoints, so the whole
// file is one chunk: an "already exists" from any statement would skip the
// REST of the file too (the trigger, most likely), and a non-idempotent
// statement would fail the deploy outright. So every statement in the file has
// to stand on its own, and the trigger has to be dropped before it is created.
//
// The second half pins the drizzle schema's relations to the SQL. The infra test
// proves the SQL cascades; nothing proved the schema says the same, and the
// org-purge guard reasons from the schema.

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'drizzle')
const FILE = '0072_product_feedback_votes.sql'
const raw = fs.readFileSync(path.join(DIR, FILE), 'utf8')

// Comments out, string literals blanked, so ';' means a statement terminator.
const code = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''")

const statements = code(raw)
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean)

describe(`${FILE} under the migration runner`, () => {
  it('is applied after every earlier migration and has a unique number', () => {
    const all = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    const prefix = FILE.slice(0, 4)
    expect(all.filter((f) => f.startsWith(prefix + '_'))).toEqual([FILE])
    const prev = all[all.indexOf(FILE) - 1]
    expect(Number(prev.slice(0, 4))).toBe(Number(prefix) - 1)
  })

  it('the runner still sorts by name and splits only on the breakpoint marker', () => {
    // The shape checks below are only meaningful while this is the contract.
    const runner = fs.readFileSync(path.join(ROOT, 'lib/db/migrate.ts'), 'utf8')
    expect(runner).toContain(".filter((f) => f.endsWith('.sql'))")
    expect(runner).toContain('.sort()')
    expect(runner).toContain(".split('--> statement-breakpoint')")
  })

  it('is one chunk — no breakpoint markers — holding exactly four terminated statements', () => {
    expect(raw).not.toContain('--> statement-breakpoint')
    expect(code(raw).trim().endsWith(';'), 'file does not end with a semicolon').toBe(true)
    expect(statements).toHaveLength(4)
  })

  it('every statement is idempotent on its own, since the already-exists skip would drop the rest of the chunk', () => {
    for (const stmt of statements) {
      if (/^CREATE TABLE/i.test(stmt)) expect(stmt).toMatch(/^CREATE TABLE IF NOT EXISTS/i)
      else if (/^CREATE (UNIQUE )?INDEX/i.test(stmt)) expect(stmt).toMatch(/INDEX IF NOT EXISTS/i)
      else if (/^DROP TRIGGER/i.test(stmt)) expect(stmt).toMatch(/^DROP TRIGGER IF EXISTS/i)
      else if (/^CREATE TRIGGER/i.test(stmt)) {
        // Re-runnable only because the matching DROP precedes it (next test).
        expect(stmt).toMatch(/^CREATE TRIGGER trg_product_feedback_votes_changed /)
      } else {
        expect.fail(`unexpected statement kind in a breakpoint-free migration:\n${stmt}`)
      }
    }
  })

  it('uses nothing the splitter or the already-exists skip cannot handle, and is additive only', () => {
    const body = code(raw)
    expect(body).not.toMatch(/\$\$|\$[a-z_]*\$/i) // dollar-quoted bodies hide semicolons
    expect(body).not.toMatch(/\bDO\s+\$|\bBEGIN\b|\bCOMMIT\b/i)
    expect(body).not.toMatch(/\bCONCURRENTLY\b/i) // cannot run in a transaction block
    expect(body).not.toMatch(/\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i)
  })

  it('drops the trigger before creating it, so a fresh database and a re-run both end with exactly one', () => {
    const body = code(raw)
    const drop = body.indexOf('DROP TRIGGER IF EXISTS trg_product_feedback_votes_changed ON product_feedback_votes')
    const create = body.indexOf('CREATE TRIGGER trg_product_feedback_votes_changed')
    expect(drop, 'DROP TRIGGER IF EXISTS missing').toBeGreaterThan(-1)
    expect(create, 'CREATE TRIGGER missing').toBeGreaterThan(-1)
    expect(drop).toBeLessThan(create)
    expect(body.match(/CREATE TRIGGER/g)).toHaveLength(1)
    expect(body.match(/DROP TRIGGER/g)).toHaveLength(1)
  })

  it('calls a trigger function that an earlier migration defines', () => {
    const fn = 'notify_product_feedback_changed'
    expect(code(raw)).toContain(`EXECUTE FUNCTION ${fn}()`)
    const definers = fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f !== FILE)
      .filter((f) => new RegExp(`CREATE OR REPLACE FUNCTION ${fn}\\(\\)`).test(fs.readFileSync(path.join(DIR, f), 'utf8')))
    expect(definers.length, `no migration defines ${fn}()`).toBeGreaterThan(0)
    for (const f of definers) expect(f < FILE, `${f} must sort before ${FILE}`).toBe(true)
  })
})

describe('drizzle schema agrees with the SQL on relations', () => {
  const cfg = getTableConfig(productFeedbackVotes)

  it('declares three foreign keys, every one cascading, to the same tables the SQL references', () => {
    const fks = cfg.foreignKeys.map((fk) => {
      const ref = fk.reference()
      return {
        column: ref.columns[0].name,
        table: getTableConfig(ref.foreignTable).name,
        target: ref.foreignColumns[0].name,
        onDelete: fk.onDelete,
      }
    })
    expect(fks).toHaveLength(3)
    expect(fks.map((f) => f.onDelete)).toEqual(['cascade', 'cascade', 'cascade'])

    const expected = new Map([
      ['feedback_id', getTableConfig(productFeedback).name],
      ['user_id', getTableConfig(users).name],
      ['org_id', getTableConfig(orgs).name],
    ])
    for (const fk of fks) {
      expect(fk.table, `${fk.column} points at the wrong table`).toBe(expected.get(fk.column))
      expect(fk.target).toBe('id')
      // The SQL says the same thing, word for word.
      expect(code(raw).replace(/\s+/g, ' ')).toContain(
        `${fk.column} INTEGER NOT NULL REFERENCES ${fk.table}(${fk.target}) ON DELETE CASCADE`,
      )
    }
  })

  it('declares the one-vote-per-person rule as the same named unique constraint', () => {
    expect(cfg.uniqueConstraints).toHaveLength(1)
    const u = cfg.uniqueConstraints[0]
    expect(u.name).toBe('product_feedback_votes_unique')
    expect(u.columns.map((c) => c.name)).toEqual(['feedback_id', 'user_id'])
    expect(code(raw).replace(/\s+/g, ' ')).toContain(`CONSTRAINT ${u.name} UNIQUE (feedback_id, user_id)`)
  })
})
