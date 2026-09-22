import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

/**
 * Site imports used to apply the page cap at *discovery*, before the
 * already-ingested dedup ran. That made re-importing a no-op: mapping returned
 * the same first 25 URLs, all of them already ingested, and the run created
 * nothing — so any site larger than the cap was permanently truncated.
 *
 * The fix separates the two limits. These assertions pin that separation,
 * because collapsing them back into one number restores the bug silently: the
 * import still succeeds, still reports pages, and simply never reaches the rest
 * of the site.
 */
describe('site import: discovery is decoupled from the scrape budget', () => {
  const src = () => read('lib/ingest/url.ts')

  it('defines separate constants for pages scraped and URLs discovered', () => {
    const s = src()
    expect(s).toMatch(/const MAX_PAGES = \d+/)
    expect(s).toMatch(/const MAX_DISCOVERY = \d+/)
  })

  it('discovers strictly more URLs than it scrapes per run', () => {
    const s = src()
    const scrape = Number(s.match(/const MAX_PAGES = (\d+)/)?.[1])
    const discover = Number(s.match(/const MAX_DISCOVERY = (\d+)/)?.[1])
    expect(Number.isFinite(scrape)).toBe(true)
    expect(Number.isFinite(discover)).toBe(true)
    // Equal values are the original bug: the cap lands before dedup and
    // re-imports can never move past the first page-load.
    expect(discover).toBeGreaterThan(scrape)
  })

  it('maps against the discovery limit, not the scrape budget', () => {
    const s = src()
    expect(s).toContain('app.mapUrl(url, { limit: MAX_DISCOVERY })')
    expect(s).not.toContain('app.mapUrl(url, { limit })')
  })

  it('slices the scrape budget from the un-ingested set, not the raw discovered set', () => {
    const s = src()
    // Slicing mappedUrls instead would re-truncate before dedup had any effect.
    expect(s).toContain('notYetIngested.slice(0, scrapeBudget)')
  })

  it('caps the per-run scrape budget at MAX_PAGES even if a caller asks for more', () => {
    const s = src()
    expect(s).toContain('Math.min(maxPages, MAX_PAGES)')
  })
})

describe('site import: remaining count reaches the user', () => {
  it('computes remaining as un-ingested pages this run had no budget for', () => {
    const s = read('lib/ingest/url.ts')
    expect(s).toContain('const remaining = notYetIngested.length - candidateUrls.length')
  })

  it('returns remaining from ingestSite', () => {
    const s = read('lib/ingest/url.ts')
    expect(s).toContain('return { created, pages: scraped, pagesFound, skipped, remaining, incomplete }')
  })

  it('mock mode reports remaining too, so callers can rely on the field existing', () => {
    const s = read('lib/ingest/url.ts')
    const mockReturns = [...s.matchAll(/return \{ created[^}]*pagesFound: 1[^}]*\}/g)].map((m) => m[0])
    expect(mockReturns.length).toBeGreaterThan(0)
    for (const r of mockReturns) {
      expect(r, 'mock-mode return omits remaining').toContain('remaining:')
    }
  })

  it('the server action passes remaining through', () => {
    const s = read('lib/actions/ingest-url.ts')
    expect(s).toContain('remaining: result.remaining')
    expect(s).toContain('remaining?: number')
  })

  it('the KB page tells the user another import will continue', () => {
    const s = read('app/(dashboard)/kb/page.tsx')
    expect(s).toContain('result.remaining')
    expect(s).toMatch(/click Import again to continue/i)
  })

  it('does not claim more pages remain when the import was interrupted instead', () => {
    const s = read('app/(dashboard)/kb/page.tsx')
    // `incomplete` already tells the user to re-run; showing both messages
    // would double up and imply two different reasons for the same retry.
    expect(s).toContain('!result.incomplete && result.remaining')
  })
})

describe('site import: dedup stays batched', () => {
  it('exports a set-returning batch lookup rather than a per-filename query', async () => {
    const mod = await import('@/lib/db/queries/kb-sources')
    expect(typeof mod.getExistingSourceFilenames).toBe('function')
  })

  it('short-circuits on an empty list instead of issuing an empty IN query', async () => {
    const { getExistingSourceFilenames } = await import('@/lib/db/queries/kb-sources')
    // No DB is configured in unit tests; this resolving at all proves the
    // early return runs before any connection is attempted.
    await expect(getExistingSourceFilenames(1, [])).resolves.toEqual(new Set())
  })

  it('scopes the batch lookup to the org', () => {
    const s = read('lib/db/queries/kb-sources.ts')
    const fnStart = s.indexOf('export async function getExistingSourceFilenames')
    const fnBody = s.slice(fnStart, fnStart + 600)
    expect(fnBody).toContain('eq(kbSources.orgId, orgId)')
    expect(fnBody).toContain('inArray(kbSources.filename, filenames)')
  })

  it('still re-checks each page before insert, since a resolved URL can differ from the mapped one', () => {
    const s = read('lib/ingest/url.ts')
    const batchIdx = s.indexOf('app.batchScrape(')
    const afterBatch = s.slice(batchIdx)
    expect(afterBatch).toContain('getKBSourceByFilename(orgId, pageUrl)')
  })
})
