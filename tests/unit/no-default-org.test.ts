import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Ban the `orgId = DEFAULT_ORG_ID` default-parameter pattern in lib/.
//
// This silent fallback to org 1 was the root cause of every cross-tenant leak
// fixed in the tenant-isolation work: a caller forgets to pass orgId, the code
// compiles, and org 1's data quietly serves every tenant. Tenant-data
// functions must take a required orgId so a missing argument is a compile
// error, not a data leak.
//
// schema.ts is exempt (it defines the constant). bot/index.ts intentionally
// uses DEFAULT_ORG_ID explicitly for the self-hosted single-org env-var
// fallback path — explicit use at a call site is visible in review; a default
// parameter is not.
//
// lib/actions/ is exempt too, for the same reason as bot/index.ts: these are
// Next.js Server Actions ("use server"), the caller boundary that resolves
// org from the session — not tenant-data functions that take orgId as an
// argument. They used to live at app/actions/ (outside this walk) and moved
// under lib/ for organization only; the exemption preserves the original
// scope of the ban rather than widening it to a folder it was never meant to
// cover. Tenant-data functions elsewhere in lib/ are still fully banned.

const LIB = path.join(process.cwd(), 'lib')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

function isExempt(f: string): boolean {
  return f.endsWith(`db${path.sep}schema.ts`) || f.includes(`actions${path.sep}`)
}

describe('no DEFAULT_ORG_ID default parameters in lib/', () => {
  it('no lib file declares `= DEFAULT_ORG_ID` as a parameter default', () => {
    const offenders = walk(LIB)
      .filter((f) => !isExempt(f))
      .filter((f) => fs.readFileSync(f, 'utf-8').includes('= DEFAULT_ORG_ID'))
      .map((f) => path.relative(process.cwd(), f))
    expect(offenders, `Silent org-1 fallback reintroduced in: ${offenders.join(', ')}`).toEqual([])
  })

  it('lib files do not import DEFAULT_ORG_ID at all (schema.ts and lib/actions/ excepted)', () => {
    const offenders = walk(LIB)
      .filter((f) => !isExempt(f))
      .filter((f) => fs.readFileSync(f, 'utf-8').includes('DEFAULT_ORG_ID'))
      .map((f) => path.relative(process.cwd(), f))
    expect(offenders, `DEFAULT_ORG_ID used in lib (org must come from the caller): ${offenders.join(', ')}`).toEqual([])
  })
})
