import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Reported bug: importing a site that yields 0 pages (e.g. an unreachable
// domain, a waitlist/login gate, or robots.txt blocking the crawler) showed
// "Imported 0 articles from 0 pages." in green — the same success color as a
// real import. The color logic only branched on `incomplete`, never on
// whether anything was actually created. Same bug existed in the single-file
// upload status message. Source-shape assertions against the internal
// (non-exported) FileUploadSection/UrlIngestSection functions in
// app/(dashboard)/kb/page.tsx — matches this repo's convention for
// UI-logic-in-page-component cases (see tests/unit/billing-limit-warning.test.ts).

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

const src = () => readSrc('app/(dashboard)/kb/page.tsx')

describe('UrlIngestSection — status color reflects whether anything was actually imported', () => {
  it('is red when created is 0, checked before the incomplete (amber) case', () => {
    const s = src()
    const idx = s.indexOf("result.created === 0 && !result.duplicates ? 'text-red-600' : result.incomplete ? 'text-amber-600' : 'text-green-600'")
    expect(idx).toBeGreaterThan(-1)
  })

  it('shows a diagnostic message instead of "Imported 0 articles from 0 pages" when nothing was found and nothing was skipped', () => {
    const s = src()
    expect(s).toContain('result.pages === 0 && !result.skipped')
    expect(s).toMatch(/No pages found at this URL/)
    expect(s).toMatch(/robots\.txt/)
  })

  it('still shows the normal "N already in KB, skipped" message when pages were found but all were duplicates', () => {
    const s = src()
    // The skipped-only path must remain distinct from the true "found nothing" path.
    const branchIdx = s.indexOf('result.pages === 0 && !result.skipped')
    const fallbackIdx = s.indexOf('Imported ${result.created} articles from ${result.pages}')
    expect(fallbackIdx).toBeGreaterThan(branchIdx)
  })
})

describe('FileUploadSection — status color reflects whether any chunks were extracted', () => {
  it('is red when created is 0', () => {
    const s = src()
    const idx = s.indexOf("result.created === 0 ? 'text-red-600' : 'text-green-600'")
    expect(idx).toBeGreaterThan(-1)
  })

  it('shows a diagnostic message instead of "Ingested 0 chunks" when nothing was extracted', () => {
    const s = src()
    expect(s).toMatch(/No chunks extracted from \$\{result\.filename\}/)
  })
})
