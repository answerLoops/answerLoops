import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Background re-processing jobs are marked, run after anything a person or a
// push queued, become full syncs when a push or click lands while they wait,
// and each write checks the worker still owns its job.

const h = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb: () => ({ execute: h.execute }) }))

const dialect = new PgDialect()
const queries = () => h.execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL))
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('enqueueKbSyncJob — re-processing jobs', () => {
  it('marks a re-processing job when it creates one', async () => {
    h.execute.mockResolvedValueOnce([{ id: 9, status: 'queued' }])
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    await enqueueKbSyncJob({ orgId: 7, kind: 'github_repo', repoId: 4, reprocessOnly: true })
    const insert = queries()[0]
    expect(insert.sql).toMatch(/INSERT INTO kb_sync_jobs \(org_id, kind, repo_id, not_before, reprocess_only\)/)
    expect(insert.params).toEqual([7, 'github_repo', 4, null, true])
  })

  it('turns a waiting re-processing job into a full sync when a push or click arrives', async () => {
    h.execute
      .mockResolvedValueOnce([]) // insert hit the one-active index
      .mockResolvedValueOnce([{ id: 9, status: 'queued', reprocess_only: true }])
      .mockResolvedValueOnce([{ id: 9 }])
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    const job = await enqueueKbSyncJob({ orgId: 7, kind: 'github_repo', repoId: 4, rerunIfRunning: true })
    expect(job).toEqual({ id: 9, status: 'queued', created: false })
    const upgrade = queries()[2]
    expect(upgrade.sql).toMatch(/UPDATE kb_sync_jobs SET reprocess_only = false/)
    expect(upgrade.sql).toMatch(/status = 'queued'/)
  })

  it('a running re-processing job gets a full follow-up run for a push', async () => {
    h.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, status: 'running', reprocess_only: true }])
      .mockResolvedValueOnce([{ id: 9 }])
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    await enqueueKbSyncJob({ orgId: 7, kind: 'github_repo', repoId: 4, rerunIfRunning: true })
    expect(queries()[2].sql).toMatch(/SET rerun_requested = true/)
  })
})

describe('claimNextKbSyncJob', () => {
  it('claims syncs a person or a push queued before background re-processing', async () => {
    h.execute.mockResolvedValueOnce([])
    const { claimNextKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    await claimNextKbSyncJob()
    expect(queries()[0].sql).toMatch(/ORDER BY reprocess_only, created_at/)
  })
})

describe('assertKbSyncJobOwned', () => {
  it('passes while the job is still this worker\'s, and throws a lost lease otherwise', async () => {
    const { assertKbSyncJobOwned } = await import('@/lib/db/queries/kb-sync-jobs')
    const { KbSyncLeaseLostError } = await import('@/lib/kb-sync/errors')
    const tx = { execute: vi.fn().mockResolvedValueOnce([{ id: 5 }]).mockResolvedValueOnce([]) }
    await expect(assertKbSyncJobOwned(tx as never, 5, 2)).resolves.toBeUndefined()
    await expect(assertKbSyncJobOwned(tx as never, 5, 2)).rejects.toBeInstanceOf(KbSyncLeaseLostError)
    const q = dialect.sqlToQuery(tx.execute.mock.calls[0][0] as SQL)
    expect(q.sql).toMatch(/status = 'running'/)
    expect(q.sql).toMatch(/FOR SHARE/)
    expect(q.params).toEqual([5, 2])
  })
})

describe('run route', () => {
  const src = read('app/api/kb/sync-jobs/run/route.ts')

  it('runs a re-processing job without the Discussions rebuild, and guards every file write', () => {
    expect(src).toContain('reprocessOnly: job.reprocess_only')
    expect(src).toMatch(/if \(job\.reprocess_only\)[\s\S]*describeRepoSync\(docs\.result, null\)/)
    expect(src).toContain('guard: (tx) => assertKbSyncJobOwned(tx, jobId, attempt)')
  })
})

describe('migration 0088', () => {
  it('adds the re-processing marker to kb_sync_jobs', () => {
    expect(read('drizzle/0088_kb_source_files.sql')).toMatch(/ALTER TABLE kb_sync_jobs ADD COLUMN IF NOT EXISTS reprocess_only BOOLEAN NOT NULL DEFAULT false;/)
  })
})
