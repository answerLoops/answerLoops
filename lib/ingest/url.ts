import FirecrawlApp from '@mendable/firecrawl-js'
import { embedTextWithModel, assertEmbeddingAvailable } from '@/lib/ai/embed'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { countArticles } from '@/lib/db/queries/kb'
import { findExactDuplicate } from '@/lib/db/queries/kb-duplicates'
import { getDb } from '@/lib/db/drizzle'
import { createArticleFromSourceWithinCap } from '@/lib/db/queries/kb-article-cap'
import { createKBSource, deleteKBSource, getKBSourceByFilename, getExistingSourceFilenames, updateKBSourceChunkCount } from '@/lib/db/queries/kb-sources'
import { MAX_ARTICLES_PER_ORG } from '@/lib/kb/limits'
import { assertImportableUrl, filterImportableUrls, type ValidatedImportUrl } from '@/lib/ingest/url-validation'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'

const MAX_CHUNK_CHARS = 1800
const MIN_CHUNK_CHARS = 60

// Import limits. Each saved chunk costs an embedding call, so the work per
// import and the total KB size per org are bounded.
const MAX_PAGES = 25                  // pages scraped per import run
const MAX_CHUNKS_PER_IMPORT = 150     // bounds embeddings per whole import run
const MAX_TOTAL_CHARS = 600_000       // bounds total text embedded per whole import run
const MAX_QUESTION_CHARS = 300        // heading / title length per article

// How many URLs to *discover* per run — a different question from how many to
// scrape. Discovery is one cheap mapping request regardless of how wide it
// goes; MAX_PAGES above is the expensive half.
//
// These used to be the same number, which meant the page cap was applied
// before the already-ingested dedup ran. Re-importing a site could therefore
// never continue into it: mapping returned the same first 25 URLs, every one
// already ingested, and the run created nothing. Any site larger than 25 pages
// was permanently truncated. Discovering wide and scraping narrow lets
// repeated imports walk the whole site, MAX_PAGES at a time, without needing
// offset support from the import service.
const MAX_DISCOVERY = 500

// The import service's crawl/batch-scrape rate limit is per *request*, not
// per page (its lowest published tier allows just 1 such request/min). A
// site import must therefore always be ONE batch-scrape call regardless of
// page count — never split into multiple calls, which would multiply
// request usage instead of reducing it. SCRAPE_CONCURRENCY instead bounds
// how many pages that one call fetches in parallel internally (a separate,
// per-job concurrency limit); kept low so it stays under the lowest
// published concurrent-browser tier since we can't detect the account's plan.
const SCRAPE_CONCURRENCY = 2

export class IngestLimitError extends Error {}

/**
 * Shared chunk and character allowance for one import run. A site import hands
 * the same budget to every page so the caps bound the whole run, not each page.
 */
export interface ImportBudget {
  chunks: number
  chars: number
}

function newBudget(): ImportBudget {
  return { chunks: MAX_CHUNKS_PER_IMPORT, chars: MAX_TOTAL_CHARS }
}

function budgetExhausted(b: ImportBudget): boolean {
  return b.chunks <= 0 || b.chars <= 0
}

function clampQuestion(text: string): string {
  const t = text.trim()
  return t.length > MAX_QUESTION_CHARS ? t.slice(0, MAX_QUESTION_CHARS).trimEnd() : t
}

interface Chunk {
  question: string
  answer: string
}

export function chunkMarkdown(markdown: string, pageTitle: string): Chunk[] {
  // Split on h2/h3 headings; each section = one KB article
  const sections = markdown.split(/\n(?=#{2,3} )/)
  const chunks: Chunk[] = []
  const fallbackTitle = clampQuestion(pageTitle)

  for (const section of sections) {
    const lines = section.trim().split('\n')
    const heading = clampQuestion(lines[0].replace(/^#+\s*/, ''))
    const body = lines.slice(1).join('\n').trim()

    if (body.length < MIN_CHUNK_CHARS) continue

    // If a section is very long, split on double-newline paragraphs
    if (body.length > MAX_CHUNK_CHARS) {
      const paras = body.split(/\n{2,}/)
      let current = ''
      for (const para of paras) {
        if ((current + para).length > MAX_CHUNK_CHARS && current) {
          chunks.push({ question: heading || fallbackTitle, answer: current.trim() })
          current = para
        } else {
          current = current ? `${current}\n\n${para}` : para
        }
      }
      if (current.trim().length >= MIN_CHUNK_CHARS) {
        chunks.push({ question: heading || fallbackTitle, answer: current.trim() })
      }
    } else {
      chunks.push({ question: heading || fallbackTitle, answer: body })
    }
  }

  // Fallback: no headings → whole page as one chunk
  if (chunks.length === 0 && markdown.trim().length >= MIN_CHUNK_CHARS) {
    chunks.push({
      question: fallbackTitle,
      answer: markdown.trim().slice(0, MAX_CHUNK_CHARS),
    })
  }

  return chunks
}

function makeClient() {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set')
  const apiUrl = process.env.FIRECRAWL_API_URL // optional: point to self-hosted instance
  return new FirecrawlApp({ apiKey, ...(apiUrl ? { apiUrl } : {}) })
}

// Trim a chunk list to what is left of the run's shared budget (count + total
// chars), and spend that budget so later pages see only the remainder.
function applyImportCaps(chunks: Chunk[], budget: ImportBudget): Chunk[] {
  const capped: Chunk[] = []
  for (const chunk of chunks) {
    if (budget.chunks <= 0) break
    const len = chunk.question.length + chunk.answer.length
    if (len > budget.chars) break
    budget.chars -= len
    budget.chunks -= 1
    capped.push(chunk)
  }
  return capped
}

// Embed and persist chunks linked to a kb_sources row. The per-org article
// ceiling is enforced by the insert itself (serialised per org), so concurrent
// imports cannot overshoot it. `progress.created` is kept current so a caller
// can tell whether anything landed if this throws part-way. A chunk whose exact
// text is already in the workspace is left out and counted in
// `progress.duplicates`.
async function saveChunks(
  chunks: Chunk[],
  orgId: number,
  sourceId: number,
  budget: ImportBudget,
  progress: { created: number; duplicates: number },
): Promise<number> {
  const existing = await countArticles(orgId)
  if (existing >= MAX_ARTICLES_PER_ORG) throw new IngestLimitError(KB_FULL_MESSAGE)
  const budgeted = applyImportCaps(chunks, budget).slice(0, MAX_ARTICLES_PER_ORG - existing)

  let lastError: unknown
  for (const chunk of budgeted) {
    try {
      // Checked before embedding so a section already in the knowledge base
      // costs nothing; the insert checks again under the workspace lock.
      if ((await findExactDuplicate(getDb(), orgId, chunk.question, chunk.answer)) !== null) {
        progress.duplicates++
        continue
      }
      const { embedding, model } = await embedTextWithModel(`${chunk.question}\n\n${chunk.answer}`, orgId)
      const row = await createArticleFromSourceWithinCap(
        { question: chunk.question, answer: chunk.answer, embedding, model, sourceId },
        orgId,
        MAX_ARTICLES_PER_ORG,
      )
      if (!row) {
        if (progress.created === 0) throw new IngestLimitError(KB_FULL_MESSAGE)
        break
      }
      if ('duplicateOf' in row) {
        progress.duplicates++
        continue
      }
      progress.created++
    } catch (err) {
      if (err instanceof IngestLimitError) throw err
      // No provider is configured for this workspace: every remaining chunk
      // would fail the same way, so stop and let the caller report it.
      if (err instanceof NoAIProviderConfiguredError) throw err
      lastError = err
    }
  }
  if (progress.created === 0 && lastError) throw lastError
  return progress.created
}

const KB_FULL_MESSAGE = `Knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before importing more.`

/**
 * Create the source row, save its chunks, and record the count. When saving
 * fails before any article exists, the source row is removed again so a retry
 * is not treated as "already imported".
 */
async function importAsSource(opts: {
  orgId: number
  filename: string
  sizeBytes: number
  chunks: Chunk[]
  budget: ImportBudget
}): Promise<{ created: number; duplicates: number }> {
  const source = await createKBSource({
    orgId: opts.orgId,
    filename: opts.filename,
    fileType: 'url',
    sizeBytes: opts.sizeBytes,
  })
  const progress = { created: 0, duplicates: 0 }
  try {
    await saveChunks(opts.chunks, opts.orgId, source.id, opts.budget, progress)
  } catch (err) {
    if (progress.created === 0) {
      await deleteKBSource(source.id, opts.orgId).catch((cleanupErr) =>
        logger.warn('could not remove empty import source', { module: 'ingest/url', sourceId: source.id, error: cleanupErr }),
      )
    } else {
      await updateKBSourceChunkCount(source.id, progress.created).catch(() => {})
    }
    throw err
  }
  await updateKBSourceChunkCount(source.id, progress.created)
  return { created: progress.created, duplicates: progress.duplicates }
}

/** True when a source for this page already exists, under its canonical name or the raw name older imports used. */
async function sourceExists(orgId: number, canonical: string, raw?: string): Promise<boolean> {
  if (await getKBSourceByFilename(orgId, canonical)) return true
  return raw !== undefined && raw !== canonical ? Boolean(await getKBSourceByFilename(orgId, raw)) : false
}

/** Validate a typed address, then scrape it and save each heading section as a KB article. */
export async function ingestUrl(rawUrl: string, orgId: number): Promise<{ created: number; duplicates?: number; skipped?: boolean }> {
  const url = await assertImportableUrl(rawUrl, { resolveDns: !MOCK_EXTERNALS })
  return ingestValidatedUrl(url, orgId, rawUrl.trim())
}

/**
 * Scrape one address that has already been through assertImportableUrl and
 * save each heading section as a KB article. The caller does the validation
 * (and its DNS lookup) once; the type makes sure it was done. `rawUrl` is the
 * address as typed, used to recognise a page imported under that spelling by
 * an earlier version.
 */
export async function ingestValidatedUrl(
  url: ValidatedImportUrl,
  orgId: number,
  rawUrl?: string,
): Promise<{ created: number; duplicates?: number; skipped?: boolean }> {
  // Refuse before scraping when this workspace has no usable embedding provider.
  await assertEmbeddingAvailable(orgId)
  if (MOCK_EXTERNALS) {
    const mockMd = `## Mock Page\n\nThis is mock content for ${url}. It contains enough text to be chunked into a KB article for testing purposes.`
    if (await sourceExists(orgId, url, rawUrl)) return { created: 0, skipped: true }
    const chunks = chunkMarkdown(mockMd, 'Mock Page')
    const { created, duplicates } = await importAsSource({ orgId, filename: url, sizeBytes: mockMd.length, chunks, budget: newBudget() })
    return { created, duplicates }
  }

  // Skip if already ingested
  if (await sourceExists(orgId, url, rawUrl)) return { created: 0, skipped: true }

  const app = makeClient()

  const result = await app.scrapeUrl(url, { formats: ['markdown'] })
  if (!('markdown' in result) || !result.markdown) {
    throw new Error(`Firecrawl scrape failed for ${url}`)
  }

  // Chunk first, then create the source row only as part of saving, so a
  // failure never leaves a source behind that blocks a retry.
  const title = (result as { metadata?: { title?: string } }).metadata?.title ?? url
  const chunks = chunkMarkdown(result.markdown, title)
  const { created, duplicates } = await importAsSource({
    orgId,
    filename: url,
    sizeBytes: result.markdown.length,
    chunks,
    budget: newBudget(),
  })
  return { created, duplicates }
}

/**
 * Validate a typed address, then crawl the site and save all heading sections
 * as KB articles. See ingestValidatedSite.
 */
export async function ingestSite(
  rawUrl: string,
  orgId: number,
  maxPages = MAX_PAGES,
): Promise<SiteImportResult> {
  const url = await assertImportableUrl(rawUrl, { resolveDns: !MOCK_EXTERNALS })
  return ingestValidatedSite(url, orgId, maxPages, rawUrl.trim())
}

export interface SiteImportResult {
  created: number
  pages: number
  pagesFound: number
  skipped: number
  /** Sections left out because their exact text is already in the knowledge base. */
  duplicates: number
  remaining: number
  incomplete: boolean
}

/**
 * Crawl a site (an address that has already been through assertImportableUrl)
 * and save all heading sections as KB articles.
 *
 * Discovers up to MAX_DISCOVERY URLs but scrapes at most MAX_PAGES of them per
 * run, choosing pages that have not been ingested yet. Re-running therefore
 * continues further into the site rather than re-examining the same first
 * page-load; `remaining` reports how many known-but-unscraped pages are left,
 * so a caller can tell "finished" apart from "hit this run's budget".
 */
export async function ingestValidatedSite(
  url: ValidatedImportUrl,
  orgId: number,
  maxPages = MAX_PAGES,
  rawUrl?: string,
): Promise<SiteImportResult> {
  // Refuse before crawling when this workspace has no usable embedding provider.
  await assertEmbeddingAvailable(orgId)
  if (MOCK_EXTERNALS) {
    const mockMd = `## Mock Site Page\n\nThis is mock site content for ${url}. It contains enough text to be chunked into a KB article for testing purposes. The site crawl returns multiple pages.`
    if (await sourceExists(orgId, url, rawUrl)) return { created: 0, pages: 1, pagesFound: 1, skipped: 1, duplicates: 0, remaining: 0, incomplete: false }
    const chunks = chunkMarkdown(mockMd, 'Mock Site Page')
    const { created, duplicates } = await importAsSource({ orgId, filename: url, sizeBytes: mockMd.length, chunks, budget: newBudget() })
    return { created, pages: 1, pagesFound: 1, skipped: 0, duplicates, remaining: 0, incomplete: false }
  }

  const app = makeClient()
  const scrapeBudget = Math.min(maxPages, MAX_PAGES)

  // Discover page URLs first (cheap — no scraping yet), then drop pages
  // already ingested before spending scrape requests on them.
  const mapResult = await app.mapUrl(url, { limit: MAX_DISCOVERY })
  const discovered = (mapResult.links ?? [])
    .map((l) => l.url)
    .filter(Boolean)
    .slice(0, MAX_DISCOVERY)
  // Only addresses that pass import validation are scraped. They are held in
  // canonical form, the same form new sources are stored under.
  const { allowed: mappedUrls, entries, rejected: rejectedUrls } = await filterImportableUrls(discovered)
  const pagesFound = mappedUrls.length
  if (rejectedUrls > 0) {
    logger.info('site import skipped discovered URLs that cannot be imported', {
      module: 'ingest/url',
      orgId,
      rejected: rejectedUrls,
    })
  }

  if (pagesFound === 0) {
    logger.warn('site import found zero pages — raw mapUrl response follows', {
      module: 'ingest/url',
      orgId,
      url,
      mapResult,
    })
  }

  // One query for the whole discovered set rather than a round trip per URL.
  // Each page is looked up under its canonical name and under the spelling it
  // was discovered with, since earlier imports stored sources under the latter.
  const lookupNames = [...new Set(entries.flatMap((e) => [e.canonical, e.raw]))]
  const alreadyIngested = await getExistingSourceFilenames(orgId, lookupNames)
  const notYetIngested = entries
    .filter((e) => !alreadyIngested.has(e.canonical) && !alreadyIngested.has(e.raw))
    .map((e) => e.canonical)
  // Mutable because the scrape loop can still discover duplicates this pass
  // missed: a page's resolved sourceURL may differ from the mapped URL after
  // a redirect or canonicalisation, so it gets re-checked before insert.
  let skipped = mappedUrls.length - notYetIngested.length

  // Take only this run's share. Whatever is left over is reported back so the
  // caller can tell the user another import will make further progress —
  // without that number, "finished" and "hit the per-run cap" look identical.
  const candidateUrls = notYetIngested.slice(0, scrapeBudget)
  const remaining = notYetIngested.length - candidateUrls.length

  let created = 0
  let duplicates = 0
  let scraped = 0
  let incomplete = false
  // One allowance for the whole run, shared by every page below.
  const budget = newBudget()

  if (candidateUrls.length > 0) {
    // One request for every candidate URL — the import service rate-limits
    // by request, not by page, so splitting this into multiple calls would
    // use more of that budget, not less. Concurrency *within* this single
    // job is bounded by SCRAPE_CONCURRENCY instead.
    let batchResult
    try {
      batchResult = await app.batchScrape(candidateUrls, {
        options: { formats: ['markdown'] },
        maxConcurrency: SCRAPE_CONCURRENCY,
      })
    } catch (err) {
      logger.warn('site import batch scrape failed — nothing scraped this run, safe to retry', {
        module: 'ingest/url',
        orgId,
        url,
        candidateCount: candidateUrls.length,
        error: err,
      })
      batchResult = undefined
      incomplete = true
    }

    for (const page of batchResult?.data ?? []) {
      if (!page.markdown) continue
      scraped++

      // The resolved page address can differ from the mapped one (redirects,
      // canonical tags), so it is checked again and stored in canonical form.
      const reportedUrl = page.metadata?.sourceURL ?? url
      let pageUrl: string
      try {
        pageUrl = await assertImportableUrl(reportedUrl)
      } catch {
        skipped++
        continue
      }

      if (await sourceExists(orgId, pageUrl, reportedUrl)) {
        skipped++
        continue
      }

      // Out of shared allowance: stop here. Pages not reached stay un-ingested,
      // so another import continues from them.
      if (budgetExhausted(budget)) {
        incomplete = true
        break
      }

      const title = page.metadata?.title ?? pageUrl
      const chunks = chunkMarkdown(page.markdown, title)
      const imported = await importAsSource({
        orgId,
        filename: pageUrl,
        sizeBytes: page.markdown.length,
        chunks,
        budget,
      })
      created += imported.created
      duplicates += imported.duplicates
    }

    // The job can also complete but return fewer documents than requested
    // (individual page failures — 404s, robots.txt blocks, timeouts) without
    // throwing. Surface that as incomplete too so the UI doesn't claim more
    // pages landed than actually did.
    if (batchResult && scraped < candidateUrls.length) {
      incomplete = true
    }
  }

  return { created, pages: scraped, pagesFound, skipped, duplicates, remaining, incomplete }
}
