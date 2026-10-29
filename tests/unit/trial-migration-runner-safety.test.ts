import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PLATFORM_PATHS, isPlatformPath } from '@/lib/marketing/platform-paths'
import { ACCESS_EXEMPT_PATHS, isAccessExempt } from '@/lib/billing/access'

// lib/db/migrate.ts splits each file on "--> statement-breakpoint" and executes
// every chunk as ONE statement, tolerating only "already exists" errors. A chunk
// holding two statements, or a statement the runner cannot take, fails the
// deploy. These tests run the runner's own splitting rule over the new files.

const dir = path.join(process.cwd(), 'drizzle')
const FILES = ['0067_free_trial_and_signup_consent.sql', '0068_trial_ending_reminders.sql']

// Same split the runner uses.
function chunks(file: string): string[] {
  return fs
    .readFileSync(path.join(dir, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
}
/** SQL with line comments and string literals removed, to count real statement terminators. */
const code = (s: string) =>
  s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/'(?:[^']|'')*'/g, "''")

const noComments = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

describe.each(FILES)('%s under the migration runner', (file) => {
  it('is applied after every earlier migration and has a unique number', () => {
    const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    const prefix = file.slice(0, 4)
    expect(all.filter((f) => f.startsWith(prefix + '_'))).toEqual([file])
    const prev = all[all.indexOf(file) - 1]
    expect(Number(prev.slice(0, 4))).toBe(Number(prefix) - 1)
  })

  it('puts exactly one terminated statement in every chunk', () => {
    for (const c of chunks(file)) {
      const body = code(c).trim()
      expect(body.endsWith(';'), `chunk does not end with a semicolon:\n${c}`).toBe(true)
      expect(body.split(';').filter((p) => p.trim()).length, `chunk holds more than one statement:\n${c}`).toBe(1)
    }
  })

  it('puts the breakpoint marker on its own line so the split cannot cut a statement', () => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    const occurrences = text.split('--> statement-breakpoint').length - 1
    const ownLine = text.split('\n').filter((l) => l.trim() === '--> statement-breakpoint').length
    expect(ownLine).toBe(occurrences)
    expect(occurrences).toBe(chunks(file).length - 1)
  })

  it('uses nothing the splitter or the already-exists skip cannot handle', () => {
    const body = code(fs.readFileSync(path.join(dir, file), 'utf8'))
    expect(body).not.toMatch(/\$\$|\$[a-z_]*\$/i) // dollar-quoted bodies contain semicolons
    expect(body).not.toMatch(/\bDO\s+\$|\bBEGIN\b|\bCOMMIT\b/i)
    expect(body).not.toMatch(/\bCONCURRENTLY\b/i) // cannot run in a transaction block
    expect(body).not.toMatch(/\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i) // additive only
  })

  it('creates and alters only idempotently', () => {
    for (const c of chunks(file)) {
      const stmt = code(c)
      if (/^\s*ALTER TABLE .* ADD COLUMN/i.test(stmt)) expect(stmt).toMatch(/ADD COLUMN IF NOT EXISTS/i)
      if (/^\s*CREATE TABLE/i.test(stmt)) expect(stmt).toMatch(/CREATE TABLE IF NOT EXISTS/i)
      if (/^\s*CREATE (UNIQUE )?INDEX/i.test(stmt)) expect(stmt).toMatch(/INDEX IF NOT EXISTS/i)
    }
  })
})

describe('0067 data backfills', () => {
  const stmts = chunks(FILES[0])
  const update = stmts.find((s) => /^(--[^\n]*\n)*\s*UPDATE users/m.test(s) || /\nUPDATE users/.test(s) || s.startsWith('UPDATE users'))!
  const insert = stmts.find((s) => /INSERT INTO trial_claims/.test(s))!

  it('the terms backfill only touches accounts with no recorded acceptance, using the sign-up time', () => {
    expect(update).toBeDefined()
    const sqlOnly = noComments(update)
    expect(sqlOnly).toMatch(/WHERE terms_accepted_at IS NULL\s*;?$/)
    expect(sqlOnly).toContain("terms_version = 'before-consent-record'")
    expect(sqlOnly).toContain('terms_accepted_at = created_at')
  })

  it('the terms backfill is the only data-changing statement against users, and runs after the column exists', () => {
    const all = stmts.map(code)
    const addCol = all.findIndex((s) => /ADD COLUMN IF NOT EXISTS terms_accepted_at/.test(s))
    const upd = all.findIndex((s) => /^\s*UPDATE users/.test(s))
    expect(addCol).toBeGreaterThan(-1)
    expect(upd).toBeGreaterThan(addCol)
    expect(all.filter((s) => /^\s*UPDATE\b/.test(s))).toHaveLength(1)
  })

  it('documents that the terms backfill is a one-shot, so a reader does not re-run it by hand', () => {
    const text = fs.readFileSync(path.join(dir, FILES[0]), 'utf8')
    expect(text).toMatch(/applies this file once/)
    expect(text).toMatch(/New accounts are never touched/)
  })

  it('the ledger backfill is a conflict-safe insert that creates the table first', () => {
    const all = stmts.map(code)
    expect(all.findIndex((s) => /CREATE TABLE IF NOT EXISTS trial_claims/.test(s))).toBeLessThan(
      all.findIndex((s) => /INSERT INTO trial_claims/.test(s)),
    )
    expect(code(insert)).toMatch(/ON CONFLICT DO NOTHING;$/)
    expect(code(insert)).toMatch(/DISTINCT ON \(k\.identity_key\)/)
  })

  it('the ledger backfill counts only owners with a usable email and a 14 day window, never the address itself', () => {
    const s = noComments(insert)
    expect(s).toContain("m.role = 'owner'")
    expect(s).toContain("position('@' in u.email) > 1")
    expect(s).toContain("interval '14 days'")
    expect(s).toContain("sha256(convert_to(")
    // the select list stores the hash, not the raw email column
    expect(s.split('FROM subscriptions')[0]).not.toMatch(/\bu\.email AS\b|\bidentity_key,\s*u\.email\b/)
  })
})

describe('platform and access-exempt path lists agree', () => {
  const pages = ACCESS_EXEMPT_PATHS.filter((p) => !p.startsWith('/api/'))

  it.each(pages)('%s is exempt from the subscription gate and is a known platform page', (p) => {
    expect(isPlatformPath(p.replace(/\/$/, ''))).toBe(true)
    expect(isAccessExempt(p)).toBe(true)
  })

  it('/accept-terms is classified in both lists', () => {
    expect(PLATFORM_PATHS).toContain('/accept-terms')
    expect(ACCESS_EXEMPT_PATHS).toContain('/accept-terms')
    expect(isAccessExempt('/accept-terms')).toBe(true)
  })

  it('every platform path is real: has a route folder', () => {
    const app = path.join(process.cwd(), 'app')
    const folders = new Set<string>()
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        if (e.name.startsWith('(')) walk(path.join(d, e.name))
        else folders.add('/' + e.name)
      }
    }
    walk(app)
    for (const p of PLATFORM_PATHS) expect(folders.has(p), `${p} has no folder under app/`).toBe(true)
  })

  it('does not exempt the product pages', () => {
    for (const p of ['/dashboard', '/tickets', '/kb', '/settings', '/billing']) expect(isAccessExempt(p)).toBe(false)
  })

  it('every exempt API route is a billing route', () => {
    for (const p of ACCESS_EXEMPT_PATHS.filter((x) => x.startsWith('/api/'))) expect(p.startsWith('/api/billing/')).toBe(true)
  })
})
