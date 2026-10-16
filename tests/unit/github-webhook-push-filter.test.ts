import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The GitHub push webhook used to run a full repo re-embed inline before
// responding — blowing GitHub's ~10s delivery deadline (→ retries → racing
// delete-and-recreate syncs) — and did it for a push to *any* ref. It now
// filters to the default branch and enqueues a debounced job.

const ROOT = process.cwd()
const src = fs.readFileSync(path.join(ROOT, 'app/api/github/webhook/route.ts'), 'utf-8')

describe('github push webhook — branch filter + enqueue', () => {
  it('only reacts to a push on the repo default branch', () => {
    expect(src).toContain('repoData.default_branch')
    expect(src).toMatch(/ref === `refs\/heads\/\$\{defaultBranch\}`/)
  })

  it('enqueues a job instead of running syncRepoToKB inline', () => {
    expect(src).toMatch(/enqueueKbSyncJob\(\{\s*orgId: actualOrgId,\s*kind: 'github_repo',\s*repoId: dbRepo\.id,/)
    // no inline sync call left in the push branch
    expect(src).not.toContain('await syncRepoToKB(')
  })

  it('still acks every delivery fast (200) regardless of branch', () => {
    const pushBlock = src.slice(src.indexOf("if (event === 'push')"), src.indexOf("const action ="))
    expect(pushBlock).toContain('return NextResponse.json({ ok: true })')
    // the enqueue is wrapped so a queue error cannot fail the ack
    expect(pushBlock).toMatch(/try \{[\s\S]*enqueueKbSyncJob[\s\S]*\} catch/)
  })

  it('debounce is the DB layer, not the route — the route enqueues unconditionally on a default-branch push', () => {
    // enqueueKbSyncJob itself collapses a burst/retry via the partial unique index
    expect(fs.readFileSync(path.join(ROOT, 'lib/db/queries/kb-sync-jobs.ts'), 'utf-8'))
      .toContain('ON CONFLICT DO NOTHING')
  })
})
