import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// The KB-sync queue: enqueue points insert into kb_sync_jobs and return; the
// bot sweep claims queued rows and drives each via POST /api/kb/sync-jobs/run.
// These are structural assertions on the load-bearing SQL — the behaviour that
// makes the queue safe (dedupe, single-claim, stuck-recovery) lives in raw SQL
// that a unit test can't exercise without a live Postgres.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

// updateKbSyncJobProgress builds its UPDATE with drizzle's sql`` tagged
// template, which is safe to import for real (no DB access) — only getDb
// itself needs mocking. This lets the tests below inspect the actual bound
// parameters a call produces, not just the source text.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))

// A drizzle sql`` template's queryChunks alternate StringChunk (literal SQL)
// and bound-parameter values — pull out just the params.
function boundParams(query: { queryChunks: unknown[] }): unknown[] {
  return query.queryChunks.filter((c) => !(c && typeof c === 'object' && 'value' in (c as object)))
}

describe('lib/db/queries/kb-sync-jobs.ts', () => {
  const src = read('lib/db/queries/kb-sync-jobs.ts')

  it('enqueue is a no-op when a job for the same source is already active', () => {
    // relies on the partial unique index kb_sync_jobs_one_active
    expect(src).toContain('INSERT INTO kb_sync_jobs')
    expect(src).toContain('ON CONFLICT DO NOTHING')
    // and falls back to returning the existing active job
    expect(src).toMatch(/status IN \('queued', 'running'\)/)
  })

  it('claim is atomic — one queued job, flipped to running, with SKIP LOCKED', () => {
    expect(src).toContain("status = 'running'")
    expect(src).toContain('attempts = attempts + 1')
    expect(src).toContain('FOR UPDATE SKIP LOCKED')
    expect(src).toMatch(/ORDER BY created_at\s+LIMIT 1/)
  })

  it('reclaim requeues a stuck job, or fails it once attempts are exhausted', () => {
    expect(src).toMatch(/WHEN attempts >= \$\{maxAttempts\} THEN 'failed' ELSE 'queued'/)
    expect(src).toContain("status = 'running' AND started_at <")
  })

  it('finish stamps a terminal status and finished_at', () => {
    expect(src).toMatch(/status = \$\{input\.status\}/)
    expect(src).toContain('finished_at = now()')
  })
})

describe('migration + schema', () => {
  it('0039 creates kb_sync_jobs with the one-active partial unique index', () => {
    const sql = read('drizzle/0039_kb_sync_jobs.sql')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS kb_sync_jobs')
    expect(sql).toContain('kb_sync_jobs_one_active')
    expect(sql).toMatch(/WHERE status IN \('queued', 'running'\)/)
    expect(sql).toContain('COALESCE(repo_id, 0)')
  })

  it('the table is registered in the drizzle schema and in hardPurgeOrg', () => {
    expect(read('lib/db/schema.ts')).toContain("'kb_sync_jobs'")
    expect(read('lib/db/schema.ts')).toContain('export const kbSyncJobs')
    expect(read('lib/db/queries/orgs.ts')).toContain('tx.delete(kbSyncJobs)')
  })
})

describe('bot worker wiring', () => {
  const src = read('bot/index.ts')

  it('starts the KB sync sweep alongside the other sweeps', () => {
    expect(src).toContain('function startKbSyncSweep()')
    expect(src).toContain('startKbSyncSweep()')
    expect(src).toContain('claimNextKbSyncJob')
    expect(src).toContain('reclaimStuckKbSyncJobs')
  })

  it('forwards each claimed job to the BOT_SECRET-gated run route', () => {
    expect(src).toContain('/api/kb/sync-jobs/run')
    expect(src).toContain('Authorization: `Bearer ${botSecret}`')
    expect(src).toMatch(/if \(!botSecret\) return/)
  })
})

describe('updateKbSyncJobProgress — current_item threading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('binds the given title as current_item', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    getDb.mockReturnValue({ execute })

    const { updateKbSyncJobProgress } = await import('@/lib/db/queries/kb-sync-jobs')
    await updateKbSyncJobProgress(42, 3, 10, 'Some Title')

    expect(execute).toHaveBeenCalledTimes(1)
    const query = execute.mock.calls[0][0] as { queryChunks: unknown[] }
    expect(boundParams(query)).toEqual([3, 10, 'Some Title', 42])
  })

  // Real regression this guards against: existing GitHub sync call sites
  // (syncRepoToKB / syncDiscussionsToKB) call this with only 3 args. Without
  // the `?? null` coalesce, a bare `${currentItem}` would bind `undefined`,
  // and postgres/pg would either reject the query or silently write nothing
  // for that column depending on the driver — either way the row's
  // current_item would NOT be cleared back to null on a job that previously
  // had a title (e.g. reused across kinds), leaving a stale title on screen.
  it('defaults current_item to null (not undefined/omitted) when no title is passed', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    getDb.mockReturnValue({ execute })

    const { updateKbSyncJobProgress } = await import('@/lib/db/queries/kb-sync-jobs')
    await updateKbSyncJobProgress(42, 3, 10)

    const query = execute.mock.calls[0][0] as { queryChunks: unknown[] }
    const params = boundParams(query)
    expect(params).toEqual([3, 10, null, 42])
    expect(params[2]).not.toBeUndefined()
  })

  it('scopes the write to status = running, so a reclaimed or finished job cannot be resurrected', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    getDb.mockReturnValue({ execute })

    const { updateKbSyncJobProgress } = await import('@/lib/db/queries/kb-sync-jobs')
    await updateKbSyncJobProgress(7, 1, 5, 'X')

    const query = execute.mock.calls[0][0] as { queryChunks: { value?: string[] }[] }
    const literalText = query.queryChunks
      .filter((c) => c && typeof c === 'object' && 'value' in c)
      .map((c) => (c.value ?? []).join(''))
      .join('')
    expect(literalText).toContain("AND status = 'running'")
  })
})
