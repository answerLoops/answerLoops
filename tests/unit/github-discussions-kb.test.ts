import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// GitHub Discussions as first-class KB (Roadmap icebox item, feat/github-discussions-kb).
// Answered Discussions now sync into the KB directly, not just as tickets: the
// discussion title becomes the question, the accepted answer becomes the answer,
// attributed to the answering GitHub user. Sync is event-driven off the existing
// `discussion` webhook (`answered` upserts, `unanswered` removes) and via a
// paginated GraphQL backfill from `POST /api/github/sync-kb`, since GitHub's
// REST API has no discussion-answer endpoint.
//
// Source-file structural assertions — vitest cannot exercise a real GitHub
// GraphQL endpoint or a live Postgres instance here. Same convention as
// tenant-isolation.test.ts / kb-url-ingest-batching.test.ts.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('lib/github/kb-sync.ts — discussion sync', () => {
  const src = read('lib/github/kb-sync.ts')

  it('exports both the full backfill and the incremental webhook sync functions', () => {
    expect(src).toContain('export async function syncDiscussionsToKB(')
    expect(src).toContain('export async function syncSingleDiscussionToKB(')
  })

  it('backfill query filters to answered discussions only, not the whole connection', () => {
    expect(src).toMatch(/discussions\(first: 50, after: \$cursor, answered: true/)
  })

  it('calls the GitHub GraphQL endpoint directly rather than REST, since REST has no discussion-answer field', () => {
    expect(src).toContain("fetch('https://api.github.com/graphql'")
    expect(src).toContain("type: 'installation'")
  })

  it('builds the article with the discussion title as question and the answer body attributed to the answering user', () => {
    expect(src).toContain('function buildDiscussionArticle(')
    expect(src).toContain('question: d.title')
    expect(src).toMatch(/Answered by @\$\{authorLogin\} on GitHub Discussions/)
  })

  it('treats a discussion with no answer body as unanswered (returns null, not an empty article)', () => {
    expect(src).toMatch(/if \(!d\.answer \|\| !d\.answer\.body\.trim\(\)\) return null/)
  })

  it('passes orgId to every embedText call so a BYO-embedding org gets its own model', () => {
    // All three GitHub KB embed sites (repo files, discussion backfill, single
    // discussion) must forward orgId — otherwise those chunks embed with the
    // platform-default model and land in a different vector space than the rest
    // of that org's KB. Matches the Notion sync path.
    const calls = [...src.matchAll(/embedText\([^)]*\)/g)].map((m) => m[0])
    expect(calls.length).toBeGreaterThanOrEqual(3)
    for (const call of calls) expect(call, call).toMatch(/,\s*orgId\)$/)
  })

  it('dedups KB articles per discussion via sourcePage = discussion number, not by re-creating on every sync', () => {
    // Backfill (fresh source each run — create is correct here)
    expect(src).toMatch(/createArticleFromSource\(\s*\{ question: article\.question, answer: article\.answer, embedding, model: EMBEDDING_MODEL, sourceId: source\.id, sourcePage: d\.number \}/)
    // Webhook path (persistent source — must upsert, not duplicate on re-answer)
    expect(src).toContain('upsertArticleFromSource(')
    expect(src).toMatch(/sourcePage: discussion\.number/)
  })

  it('removes the KB article when a discussion answer is unmarked, rather than leaving a stale article', () => {
    expect(src).toContain('deleteArticleBySourceAndPage(source.id, discussion.number, orgId)')
  })

  it('keeps the webhook path from wiping out the rest of the repo\'s discussions source (get-or-create, not delete-and-recreate)', () => {
    const singleFnIdx = src.indexOf('export async function syncSingleDiscussionToKB(')
    const tail = src.slice(singleFnIdx)
    expect(tail).toContain('getOrCreateKBSource(')
    expect(tail).not.toContain('deleteKBSource(')
  })

  it('both discussion sources share the same filename convention, so backfill and webhook upserts land in the same kb_sources row', () => {
    const matches = src.match(/`\$\{owner\}\/\$\{repo\}#discussions`/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(src).toContain('function discussionSourceFilename(')
  })
})

describe('app/api/github/webhook/route.ts — discussion answered/unanswered handling', () => {
  const src = read('app/api/github/webhook/route.ts')

  it('imports the new discussion sync function', () => {
    expect(src).toContain('syncSingleDiscussionToKB')
  })

  it('handles both answered and unanswered actions', () => {
    expect(src).toMatch(/action === 'answered' \|\| action === 'unanswered'/)
  })

  it('gates discussion KB sync on kb_enabled, independent of ticket-ingest monitored_events', () => {
    const idx = src.indexOf("action === 'answered' || action === 'unanswered'")
    expect(idx).toBeGreaterThan(-1)
    const branchLine = src.slice(idx, src.indexOf('\n', idx))
    expect(branchLine).toContain('dbRepo.kb_enabled === 1')
    expect(branchLine).not.toContain('monitored')
  })

  it('returns early after discussion KB sync so it never falls through to ticket-creation logic', () => {
    const idx = src.indexOf("action === 'answered' || action === 'unanswered'")
    const nextReturnIdx = src.indexOf('return NextResponse.json({ ok: true })', idx)
    const ticketEventsIdx = src.indexOf('// ── Ticket events', idx)
    expect(nextReturnIdx).toBeGreaterThan(-1)
    expect(nextReturnIdx).toBeLessThan(ticketEventsIdx)
  })

  it('does not crash the webhook if the discussion sync throws — errors are caught and logged', () => {
    const idx = src.indexOf("action === 'answered' || action === 'unanswered'")
    const tail = src.slice(idx, idx + 700)
    expect(tail).toContain('try {')
    expect(tail).toContain('} catch (err) {')
  })
})

describe('KB sync worker backfills discussions too', () => {
  // The sync work moved off the request path: /api/github/sync-kb now only
  // enqueues a job, and the bot-driven run route does both syncs.
  it('the enqueue route no longer runs the sync inline', () => {
    const src = read('app/api/github/sync-kb/route.ts')
    expect(src).toContain("enqueueKbSyncJob({ orgId: access.orgId, kind: 'github_repo', repoId: repo.id })")
    expect(src).not.toContain('syncRepoToKB')
    expect(src).not.toContain('syncDiscussionsToKB')
  })

  it('the run route calls both syncs sequentially — both mutate the repo kbChunkCount via read-modify-write', () => {
    const src = read('app/api/kb/sync-jobs/run/route.ts')
    expect(src).not.toMatch(/Promise\.all\(\s*\[\s*syncRepoToKB/)
    const docsIdx = src.indexOf('await syncRepoToKB(')
    const discussionsIdx = src.indexOf('await syncDiscussionsToKB(')
    expect(docsIdx).toBeGreaterThan(-1)
    expect(discussionsIdx).toBeGreaterThan(docsIdx)
  })
})

describe('lib/db/queries/kb.ts — source+page dedup helpers stay org-scoped', () => {
  const src = read('lib/db/queries/kb.ts')

  it('every new discussion-dedup query filters by orgId, not just sourceId/sourcePage', () => {
    for (const fn of ['getArticleBySourceAndPage', 'countArticlesForSource', 'deleteArticleBySourceAndPage']) {
      const idx = src.indexOf(`export async function ${fn}(`)
      expect(idx, `${fn} not found`).toBeGreaterThan(-1)
      const body = src.slice(idx, src.indexOf('\n}', idx))
      expect(body, `${fn} does not filter by orgId`).toContain('eq(kbArticles.orgId, orgId)')
    }
  })

  it('upsertArticleFromSource updates the existing article in place instead of duplicating it', () => {
    expect(src).toContain('export async function upsertArticleFromSource(')
    const idx = src.indexOf('export async function upsertArticleFromSource(')
    const body = src.slice(idx, src.indexOf('\nexport async function deleteArticle(', idx))
    expect(body).toContain('getArticleBySourceAndPage(')
    expect(body).toContain('.update(kbArticles)')
    expect(body).toContain('return createArticleFromSource(input, orgId)')
  })
})

describe('lib/db/queries/kb-sources.ts — get-or-create avoids duplicate source rows', () => {
  const src = read('lib/db/queries/kb-sources.ts')

  it('getOrCreateKBSource returns the existing row instead of always inserting', () => {
    const idx = src.indexOf('export async function getOrCreateKBSource(')
    expect(idx).toBeGreaterThan(-1)
    const nextFnIdx = src.indexOf('\nexport async function', idx + 1)
    const body = src.slice(idx, nextFnIdx)
    expect(body).toContain('getKBSourceByFilename(')
    expect(body).toMatch(/if \(existing\) return existing/)
  })
})
