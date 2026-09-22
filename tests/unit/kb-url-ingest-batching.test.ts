import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Three fixes to the "Import from URL" flow:
//
// 1. Site crawls used to send one crawlUrl(limit: 25) burst to the upstream
//    import service. That service's crawl/batch-scrape rate limit is per
//    *request*, not per page inside it (its lowest published tier allows
//    just 1 such request/minute) — so a site import must always be exactly
//    ONE batch-scrape call regardless of page count. An earlier version of
//    this fix mistakenly split large imports into several batch-scrape
//    calls, which would have made things worse (multiple requests instead
//    of one). Concurrency *within* that single call is bounded separately
//    (SCRAPE_CONCURRENCY) — a different, per-job limit, kept low since we
//    can't detect which plan tier the account is on from here.
// 2. User-facing error messages named the upstream vendor ("Firecrawl") and
//    told hosted customers to edit a .env file they don't have access to.
//    Both are now generic.
// 3. If the single batch-scrape call throws, or completes but returns fewer
//    documents than requested (individual page failures — 404s, robots.txt
//    blocks, timeouts — without the whole call throwing), the result must
//    say so. Otherwise a 40-page site capped at 25 candidates, where only
//    10 pages actually scraped, would report success with no indication 15
//    pages never landed. Fixed: the result carries pagesFound (total
//    discovered) and incomplete, and nothing already scraped is lost —
//    already-ingested pages are skipped on retry so re-running the import
//    safely continues.
//
// Source-file structural assertions — same convention as
// tenant-isolation.test.ts (this project's convention for infra logic that
// isn't easily unit-tested against a live third-party API).

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('site ingest sends exactly one batch-scrape request per import', () => {
  it('maps the site to a URL list before scraping anything', () => {
    const src = read('lib/ingest/url.ts')
    const mapIdx = src.indexOf('app.mapUrl(')
    const batchIdx = src.indexOf('app.batchScrape(')
    expect(mapIdx).toBeGreaterThan(-1)
    expect(batchIdx).toBeGreaterThan(mapIdx)
  })

  it('no longer sends an unbounded crawlUrl request for the whole site', () => {
    const src = read('lib/ingest/url.ts')
    expect(src).not.toContain('app.crawlUrl(')
  })

  it('calls batchScrape exactly once per import, not in a loop', () => {
    const src = read('lib/ingest/url.ts')
    const matches = src.match(/app\.batchScrape\(/g) ?? []
    expect(matches.length).toBe(1)
    // Guard against reintroducing a per-batch loop around the call.
    expect(src).not.toMatch(/for \([^)]*\+=\s*\w*(BATCH|CONCURRENCY)\w*\)/i)
  })

  it('bounds internal concurrency conservatively via SCRAPE_CONCURRENCY, separate from request count', () => {
    const src = read('lib/ingest/url.ts')
    expect(src).toContain('const SCRAPE_CONCURRENCY = 2')
    expect(src).toContain('maxConcurrency: SCRAPE_CONCURRENCY')
  })

  it('drops already-ingested URLs before scraping them, not only after', () => {
    const src = read('lib/ingest/url.ts')
    const mapIdx = src.indexOf('app.mapUrl(')
    const firstDedupIdx = src.indexOf('getExistingSourceFilenames', mapIdx)
    const batchIdx = src.indexOf('app.batchScrape(')
    expect(firstDedupIdx).toBeGreaterThan(mapIdx)
    expect(firstDedupIdx).toBeLessThan(batchIdx)
  })

  it('dedups the discovered set in one query rather than a round trip per URL', () => {
    const src = read('lib/ingest/url.ts')
    // Discovery now reaches far more URLs than a run scrapes, so a per-URL
    // lookup would be slowest on exactly the large sites this is meant to serve.
    const mapIdx = src.indexOf('app.mapUrl(')
    const batchIdx = src.indexOf('app.batchScrape(')
    const between = src.slice(mapIdx, batchIdx)
    expect(between).not.toContain('for (const pageUrl of mappedUrls)')
    expect(between).toContain('getExistingSourceFilenames(orgId, mappedUrls)')
  })
})

describe('user-facing import errors do not name the upstream vendor', () => {
  it('rate-limit message is generic', () => {
    const src = read('lib/actions/ingest-url.ts')
    expect(src).not.toContain('Firecrawl rate limit')
    expect(src).toContain('Import rate limit exceeded')
  })

  it('missing-API-key message does not tell hosted customers to edit a .env file', () => {
    const src = read('lib/actions/ingest-url.ts')
    expect(src).not.toContain('FIRECRAWL_API_KEY is not configured. Add it to your .env file.')
    expect(src).toContain('URL import is not configured for this workspace. Contact your administrator.')
  })

  it('still detects the same underlying SDK error to decide which message to show', () => {
    const src = read('lib/actions/ingest-url.ts')
    // Detection stays keyed on the real error content; only the wording shown to the user changed.
    expect(src).toContain("msg.includes('Rate limit exceeded') || msg.includes('FirecrawlSdkError')")
  })
})

describe('a failed or partial batch-scrape does not silently report full success', () => {
  it('wraps the batch scrape call so a thrown error does not lose already-ingested-page dedup state', () => {
    const src = read('lib/ingest/url.ts')
    const batchIdx = src.indexOf('app.batchScrape(')
    const tryIdx = src.lastIndexOf('try {', batchIdx)
    const catchIdx = src.indexOf('} catch (err) {', batchIdx)
    expect(tryIdx).toBeGreaterThan(-1)
    expect(catchIdx).toBeGreaterThan(batchIdx)
    expect(src).toContain('incomplete = true')
  })

  it('marks incomplete when the job completes but scrapes fewer pages than requested', () => {
    const src = read('lib/ingest/url.ts')
    expect(src).toContain('scraped < candidateUrls.length')
  })

  it('returns pagesFound (total discovered) alongside pages (actually scraped) and incomplete', () => {
    const src = read('lib/ingest/url.ts')
    expect(src).toContain('pagesFound: number; skipped: number; remaining: number; incomplete: boolean')
    expect(src).toContain('return { created, pages: scraped, pagesFound, skipped, remaining, incomplete }')
  })

  it('the server action passes pagesFound and incomplete through to the UI', () => {
    const src = read('lib/actions/ingest-url.ts')
    expect(src).toContain('pagesFound: result.pagesFound')
    expect(src).toContain('incomplete: result.incomplete')
  })

  it('the KB page tells the user when an import was incomplete, not just how many articles landed', () => {
    const src = read('app/(dashboard)/kb/page.tsx')
    expect(src).toContain('result.incomplete')
    expect(src).toMatch(/Import was interrupted partway through/)
  })
})
