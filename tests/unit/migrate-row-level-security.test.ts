import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// lib/db/migrate.ts enables row-level security on every table in public each
// time the app starts. The runner needs a live database, so this locks the
// behavior in through source assertions, the same way the other migration and
// route tests in this directory do.

const src = fs.readFileSync(
  path.join(process.cwd(), 'lib/db/migrate.ts'),
  'utf-8'
)

describe('lib/db/migrate.ts: row-level security', () => {
  it('enables row-level security on tables in public that do not have it', () => {
    expect(src).toContain("schemaname = 'public' AND NOT rowsecurity")
    expect(src).toContain(
      "ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY"
    )
  })

  it('runs after the migration files have been applied, so new tables are covered', () => {
    const migrationsLoopIdx = src.indexOf('for (const file of files)')
    const rlsIdx = src.indexOf('ENABLE ROW LEVEL SECURITY')
    expect(migrationsLoopIdx).toBeGreaterThan(-1)
    expect(rlsIdx).toBeGreaterThan(migrationsLoopIdx)
  })

  it('skips a table the role cannot alter instead of failing startup', () => {
    expect(src).toContain('EXCEPTION WHEN insufficient_privilege THEN')
  })

  it('does not create policies or force row security on the owner', () => {
    expect(src).not.toMatch(/CREATE POLICY/i)
    expect(src).not.toMatch(/FORCE ROW LEVEL SECURITY/i)
  })
})
