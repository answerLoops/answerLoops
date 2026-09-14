import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The internal run route the bot sweep POSTs to. Next route modules can't be
// imported in vitest (same convention as circle-webhook-route.test.ts), so
// these are structural assertions on the security- and correctness-critical
// shape.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

describe('app/api/kb/sync-jobs/run/route.ts', () => {
  const src = read('app/api/kb/sync-jobs/run/route.ts')

  it('is BOT_SECRET-gated, like retry-stuck', () => {
    expect(src).toContain("request.headers.get('authorization')")
    expect(src).toMatch(/bearer !== process\.env\.BOT_SECRET/)
    expect(src).toContain("return new Response('Unauthorized', { status: 401 })")
  })

  it('only acts on a job the sweep has already claimed (status running)', () => {
    expect(src).toMatch(/job\.status !== 'running'/)
    expect(src).toContain('ran: false')
  })

  it('dispatches by kind — notion vs github_repo', () => {
    expect(src).toContain("job.kind === 'notion'")
    expect(src).toContain('syncNotionToKB(job.org_id, { onProgress: progress })')
    expect(src).toContain("job.kind === 'github_repo'")
    const docsIdx = src.indexOf('await syncRepoToKB(')
    const discIdx = src.indexOf('await syncDiscussionsToKB(')
    expect(docsIdx).toBeGreaterThan(-1)
    expect(discIdx).toBeGreaterThan(docsIdx) // sequential, count-race safe
  })

  it('reports throttled progress into the job row', () => {
    expect(src).toContain('updateKbSyncJobProgress')
    expect(src).toContain('throttleProgress(')
    // discussion progress is offset past the repo-files total
    expect(src).toContain('progress(filesTotal + d, filesTotal + t)')
  })

  it('threads the item title from throttleProgress through to updateKbSyncJobProgress', () => {
    // throttleProgress's sink is (done, total, item) — the 3rd positional
    // arg must reach updateKbSyncJobProgress's 4th param unchanged, or a
    // Notion sync's onProgress(d, docs.length, doc.title) call would report
    // progress counts but silently drop which page is being embedded, even
    // though syncNotionToKB is already passing the title.
    const throttleIdx = src.indexOf('throttleProgress(')
    const closeIdx = src.indexOf('})', throttleIdx)
    const sinkBody = src.slice(throttleIdx, closeIdx + 2)
    expect(sinkBody).toMatch(/\(done,\s*total,\s*item\)\s*=>/)
    expect(sinkBody).toContain('updateKbSyncJobProgress(jobId, done, total, item)')
  })

  it('surfaces the Notion page/database caps in the job detail', () => {
    expect(src).toContain('res.pagesCapped')
    expect(src).toContain('res.databasesCapped')
  })

  it('records success/failure on the job and never 500s a terminal job', () => {
    expect(src).toContain("finishKbSyncJob(job.id, { status: 'succeeded'")
    expect(src).toContain("finishKbSyncJob(job.id, { status: 'failed'")
    // failure path returns 200 (Response.json) not a 500
    expect(src).toMatch(/catch \(err\) \{[\s\S]*finishKbSyncJob[\s\S]*Response\.json\(\{ ok: true, ran: true, failed: true \}\)/)
  })

  it('the run path is exempt from session auth (bot has no session)', () => {
    expect(read('auth.ts')).toContain("'/api/kb/sync-jobs/run'")
  })
})

describe('app/api/kb/sync-jobs/route.ts — status poll', () => {
  const src = read('app/api/kb/sync-jobs/route.ts')

  it('is session-gated and validates kind', () => {
    expect(src).toContain('requireOrgAccess()')
    expect(src).toMatch(/kind !== 'notion' && kind !== 'github_repo'/)
  })

  it('returns the latest job for the caller org only', () => {
    expect(src).toContain('getLatestKbSyncJob(access.orgId')
  })

  it('includes currentItem, mapped from the row\'s current_item, in the poll response', () => {
    // Without this the KB page has no way to render "Syncing: <title>" even
    // though the job row now carries it — the field would be silently
    // dropped between the DB and the client.
    expect(src).toContain('currentItem: job.current_item')
  })
})
