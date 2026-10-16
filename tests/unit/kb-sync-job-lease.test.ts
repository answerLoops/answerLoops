import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Queue hardening: org-scoped debounce, heartbeat-based reclaim, attempt-fenced
// writes, push coalescing with a cooldown, friendly job errors, and the
// owner/admin gates on the destructive KB routes. The SQL behaviour needs a
// live Postgres, so the DB-facing assertions inspect the statements that are
// sent and the bound parameters.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))

type Chunked = { queryChunks: unknown[] }
function sqlText(q: Chunked): string {
  return q.queryChunks
    .filter((c) => c && typeof c === 'object' && 'value' in (c as object))
    .map((c) => ((c as { value: string[] }).value ?? []).join(''))
    .join('?')
}
function params(q: Chunked): unknown[] {
  return q.queryChunks.filter((c) => !(c && typeof c === 'object' && 'value' in (c as object)))
}

describe('drizzle/0056_kb_sync_job_lease.sql', () => {
  const sql = read('drizzle/0056_kb_sync_job_lease.sql')

  it('recreates the one-active index scoped to the workspace, idempotently', () => {
    expect(sql).toContain('DROP INDEX IF EXISTS kb_sync_jobs_one_active')
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS kb_sync_jobs_one_active\s+ON kb_sync_jobs \(org_id, kind, COALESCE\(repo_id, 0\)\)\s+WHERE status IN \('queued', 'running'\)/)
    expect(sql.indexOf('DROP INDEX')).toBeLessThan(sql.indexOf('CREATE UNIQUE INDEX'))
  })

  it('adds the heartbeat, cooldown and follow-up columns idempotently', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS not_before timestamptz')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS rerun_requested boolean NOT NULL DEFAULT false')
  })

  it('adds the staged-text fingerprint columns used by the embedding re-index', () => {
    expect(sql).toContain('ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS embedding_next_hash text')
    expect(sql).toContain('ALTER TABLE ticket_embeddings ADD COLUMN IF NOT EXISTS vector_next_hash text')
  })

  it('the schema declares the same columns and index', () => {
    const schema = read('lib/db/schema.ts')
    expect(schema).toContain("heartbeatAt: timestamp('heartbeat_at'")
    expect(schema).toContain("notBefore: timestamp('not_before'")
    expect(schema).toContain("rerunRequested: boolean('rerun_requested')")
    expect(schema).toMatch(/uniqueIndex\('kb_sync_jobs_one_active'\)\s*\.on\(t\.orgId, t\.kind, sql`COALESCE\(\$\{t\.repoId\}, 0\)`\)/)
  })
})

describe('enqueueKbSyncJob', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('scopes the fallback lookup to the workspace', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([]) // INSERT conflicted
      .mockResolvedValueOnce([{ id: 9, status: 'queued' }]) // lookup
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    const res = await enqueueKbSyncJob({ orgId: 7, kind: 'notion' })
    expect(res).toEqual({ id: 9, status: 'queued', created: false })
    const lookup = execute.mock.calls[1][0] as Chunked
    expect(sqlText(lookup)).toContain('WHERE org_id =')
    expect(params(lookup)[0]).toBe(7)
  })

  it('source has the org filter on every fallback select', () => {
    const src = read('lib/db/queries/kb-sync-jobs.ts')
    const fn = src.slice(src.indexOf('export async function enqueueKbSyncJob'), src.indexOf('export async function claimNextKbSyncJob'))
    const selects = fn.match(/SELECT id, status FROM kb_sync_jobs\s+WHERE org_id = /g) ?? []
    expect(selects.length).toBe(1)
    expect(fn).not.toMatch(/SELECT id, status FROM kb_sync_jobs\s+WHERE kind/)
  })

  it('marks a run in progress for a follow-up when asked, and reports the existing job', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([]) // INSERT conflicted
      .mockResolvedValueOnce([{ id: 9, status: 'running' }])
      .mockResolvedValueOnce([{ id: 9 }]) // rerun flag set
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    const res = await enqueueKbSyncJob({ orgId: 7, kind: 'github_repo', repoId: 3, rerunIfRunning: true })
    expect(res).toEqual({ id: 9, status: 'running', created: false })
    const mark = execute.mock.calls[2][0] as Chunked
    expect(sqlText(mark)).toContain('rerun_requested = true')
    expect(sqlText(mark)).toContain("status = 'running'")
  })

  it('does not flag a running job when the caller did not ask for a follow-up', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, status: 'running' }])
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    await enqueueKbSyncJob({ orgId: 7, kind: 'notion' })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('inserts again when the active job finished before it could be flagged', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([]) // conflict
      .mockResolvedValueOnce([{ id: 9, status: 'running' }])
      .mockResolvedValueOnce([]) // flag matched nothing: job just finished
      .mockResolvedValueOnce([{ id: 10, status: 'queued' }]) // second insert succeeds
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    const res = await enqueueKbSyncJob({ orgId: 7, kind: 'github_repo', repoId: 3, rerunIfRunning: true })
    expect(res).toEqual({ id: 10, status: 'queued', created: true })
  })

  it('a manual sync pulls a cooling-down queued job forward and wakes the worker', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([]) // INSERT conflicted
      .mockResolvedValueOnce([{ id: 9, status: 'queued' }])
      .mockResolvedValueOnce([{ id: 9 }]) // not_before moved to now
      .mockResolvedValueOnce([]) // pg_notify
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    const res = await enqueueKbSyncJob({ orgId: 7, kind: 'github_repo', repoId: 3, pullForward: true })
    expect(res).toEqual({ id: 9, status: 'queued', created: false })
    const pull = execute.mock.calls[2][0] as Chunked
    expect(sqlText(pull)).toContain('not_before = now()')
    expect(sqlText(pull)).toContain("status = 'queued'")
    expect(params(pull)).toEqual([9, 7])
    const notify = execute.mock.calls[3][0] as Chunked
    expect(sqlText(notify)).toContain("pg_notify('kb_sync_job_queued'")
    expect(params(notify)).toEqual(['9'])
  })

  it('does not notify when the queued job was not waiting on a cooldown', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, status: 'queued' }])
      .mockResolvedValueOnce([]) // nothing to pull forward
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    const res = await enqueueKbSyncJob({ orgId: 7, kind: 'notion', pullForward: true })
    expect(res.created).toBe(false)
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('does not pull a running job forward or start a second active job', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, status: 'running' }])
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    const res = await enqueueKbSyncJob({ orgId: 7, kind: 'notion', pullForward: true })
    expect(res).toEqual({ id: 9, status: 'running', created: false })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('without pullForward (webhook path) a cooling-down queued job keeps its delay', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, status: 'queued' }])
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    await enqueueKbSyncJob({ orgId: 7, kind: 'github_repo', repoId: 3, cooldownMs: 120_000 })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('the manual Sync now routes pull forward and the webhook route does not', () => {
    expect(read('app/api/notion/sync-kb/route.ts')).toContain('pullForward: true')
    expect(read('app/api/github/sync-kb/route.ts')).toContain('pullForward: true')
    expect(read('app/api/github/webhook/route.ts')).not.toContain('pullForward')
  })

  it('delays a new job until the cooldown after the previous run has passed', async () => {
    const finished = new Date(Date.now() - 30_000)
    const execute = vi.fn()
      .mockResolvedValueOnce([{ finished_at: finished }]) // last finished job
      .mockResolvedValueOnce([{ id: 11, status: 'queued' }])
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    await enqueueKbSyncJob({ orgId: 7, kind: 'github_repo', repoId: 3, cooldownMs: 120_000 })
    const insert = execute.mock.calls[1][0] as Chunked
    const notBefore = params(insert)[3] as string
    expect(new Date(notBefore).getTime()).toBe(finished.getTime() + 120_000)
  })

  it('enqueues immediately when the previous run finished longer ago than the cooldown', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([{ finished_at: new Date(Date.now() - 600_000) }])
      .mockResolvedValueOnce([{ id: 12, status: 'queued' }])
    getDb.mockReturnValue({ execute })
    const { enqueueKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    await enqueueKbSyncJob({ orgId: 7, kind: 'github_repo', repoId: 3, cooldownMs: 120_000 })
    expect(params(execute.mock.calls[1][0] as Chunked)[3]).toBeNull()
  })
})

describe('claim, heartbeat, progress, finish and reclaim', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('claim skips jobs still inside their cooldown and stamps the first heartbeat', async () => {
    const execute = vi.fn().mockResolvedValue([])
    getDb.mockReturnValue({ execute })
    const { claimNextKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    await claimNextKbSyncJob()
    const text = sqlText(execute.mock.calls[0][0] as Chunked)
    expect(text).toContain('(not_before IS NULL OR not_before <= now())')
    expect(text).toContain('heartbeat_at = now()')
  })

  it('progress writes bump the heartbeat, are fenced to the claimed attempt, and report ownership', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ id: 5 }]).mockResolvedValueOnce([])
    getDb.mockReturnValue({ execute })
    const { updateKbSyncJobProgress } = await import('@/lib/db/queries/kb-sync-jobs')
    expect(await updateKbSyncJobProgress(5, 2, 1, 10, 'x')).toBe(true)
    expect(await updateKbSyncJobProgress(5, 2, 2, 10, 'x')).toBe(false)
    const text = sqlText(execute.mock.calls[0][0] as Chunked)
    expect(text).toContain('heartbeat_at = now()')
    expect(text).toContain("status = 'running' AND attempts =")
    expect(params(execute.mock.calls[0][0] as Chunked)).toContain(2)
  })

  it('heartbeat is fenced to the attempt and reports whether the job is still owned', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 5 }])
    getDb.mockReturnValue({ execute })
    const { heartbeatKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    expect(await heartbeatKbSyncJob(5, 1)).toBe(false)
    expect(await heartbeatKbSyncJob(5, 1)).toBe(true)
    expect(sqlText(execute.mock.calls[0][0] as Chunked)).toContain("status = 'running' AND attempts =")
  })

  function fakeTx(rows: unknown[][]) {
    const calls: Chunked[] = []
    const execute = vi.fn(async (q: Chunked) => { calls.push(q); return rows.shift() ?? [] })
    getDb.mockReturnValue({ transaction: async (fn: (tx: { execute: typeof execute }) => unknown) => fn({ execute }) })
    return { calls }
  }

  it('finish only records the outcome while the job is running at the claimed attempt', async () => {
    const { calls } = fakeTx([[]])
    const { finishKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    expect(await finishKbSyncJob(5, 2, { status: 'succeeded', detail: 'ok', syncedCount: 3 })).toBe(false)
    expect(sqlText(calls[0])).toContain("WHERE id = ? AND status = 'running' AND attempts =")
    expect(calls).toHaveLength(1)
  })

  it('finish queues exactly one delayed follow-up when a trigger arrived during the run', async () => {
    const { calls } = fakeTx([[{ org_id: 7, kind: 'github_repo', repo_id: 3, rerun_requested: true }], []])
    const { finishKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    expect(await finishKbSyncJob(5, 2, { status: 'succeeded' }, 120_000)).toBe(true)
    expect(calls).toHaveLength(2)
    expect(sqlText(calls[1])).toContain('INSERT INTO kb_sync_jobs')
    const [org, kind, repo, notBefore] = params(calls[1])
    expect([org, kind, repo]).toEqual([7, 'github_repo', 3])
    expect(new Date(notBefore as string).getTime()).toBeGreaterThan(Date.now() + 100_000)
  })

  it('finish queues no follow-up when nothing arrived during the run', async () => {
    const { calls } = fakeTx([[{ org_id: 7, kind: 'notion', repo_id: null, rerun_requested: false }]])
    const { finishKbSyncJob } = await import('@/lib/db/queries/kb-sync-jobs')
    expect(await finishKbSyncJob(5, 2, { status: 'failed', detail: 'x' })).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('reclaim is driven by the heartbeat, falling back to the start time', async () => {
    const execute = vi.fn().mockResolvedValue([{ id: 1 }])
    getDb.mockReturnValue({ execute })
    const { reclaimStuckKbSyncJobs } = await import('@/lib/db/queries/kb-sync-jobs')
    expect(await reclaimStuckKbSyncJobs(300_000, 3)).toBe(1)
    const q = execute.mock.calls[0][0] as Chunked
    expect(sqlText(q)).toContain('COALESCE(heartbeat_at, started_at::timestamptz) < now()')
    expect(params(q)).toContain(300_000)
  })
})

describe('app/api/kb/sync-jobs/run/route.ts — ownership and error text', () => {
  const src = read('app/api/kb/sync-jobs/run/route.ts')

  it('fences every job write to the claimed attempt', () => {
    expect(src).toContain('const attempt = job.attempts')
    expect(src).toContain('updateKbSyncJobProgress(jobId, attempt,')
    expect(src).toContain('heartbeatKbSyncJob(jobId, attempt)')
    expect(src).toContain('finishKbSyncJob(jobId, attempt,')
  })

  it('heartbeats on a timer and clears it when the run ends', () => {
    expect(src).toMatch(/setInterval\(\(\) => noteWrite\(heartbeatKbSyncJob/)
    expect(src).toMatch(/finally \{\s*clearInterval\(heartbeat\)/)
  })

  it('stops the sync at its next progress call once a write matched no row', () => {
    expect(src).toMatch(/if \(!owned\) leaseLost = true/)
    expect(src).toMatch(/if \(leaseLost\) throw new KbSyncLeaseLostError\(jobId\)/)
    // a worker that lost the job does not write a result
    expect(src).toMatch(/KbSyncLeaseLostError\) \{[\s\S]*superseded: true/)
  })

  it('never stores a raw error message on the job', () => {
    expect(src).not.toMatch(/err instanceof Error \? err\.message/)
    expect(src).toContain('KB_SYNC_GENERIC_FAILURE')
    expect(src).toContain('function userFacingFailure')
    const fn = src.slice(src.indexOf('function userFacingFailure'))
    expect(fn).toContain('NoAIProviderConfiguredError')
    expect(fn).toContain('KbSyncUserError')
  })

  it('the generic failure text and the known classes are what the KB page shows', () => {
    const errors = read('lib/kb-sync/errors.ts')
    expect(errors).toContain("'Sync failed — check the integration and try again.'")
    expect(read('lib/notion/kb-sync.ts')).toContain('new KbSyncUserError(')
    expect(src).toContain('new KbSyncUserError(')
  })
})

describe('owner/admin gates on destructive knowledge-base routes', () => {
  const gated = [
    ['app/api/github/sync-kb/route.ts', 1],
    ['app/api/kb/sources/[id]/route.ts', 2],
    ['app/api/kb/articles/[id]/route.ts', 1],
  ] as const

  for (const [file, count] of gated) {
    it(`${file} requires owner/admin and maps a role failure to 403`, () => {
      const src = read(file)
      expect(src.match(/requireOrgAccess\(\['owner', 'admin'\]\)/g)?.length).toBe(count)
      expect(src).not.toMatch(/requireOrgAccess\(\)/)
      expect(src.match(/status: access\.error === 'Unauthorized' \? 401 : 403/g)?.length).toBe(count)
    })
  }

  it('listing sources and polling jobs stay member-level', () => {
    expect(read('app/api/kb/sources/route.ts')).toContain('requireOrgAccess()')
    expect(read('app/api/kb/sync-jobs/route.ts')).toContain('requireOrgAccess()')
  })
})

describe('github push webhook coalescing', () => {
  const src = read('app/api/github/webhook/route.ts')

  it('enqueues with a cooldown and asks for a follow-up when a run is in progress', () => {
    expect(src).toContain('cooldownMs: PUSH_SYNC_COOLDOWN_MS')
    expect(src).toContain('rerunIfRunning: true')
    expect(src).toMatch(/const PUSH_SYNC_COOLDOWN_MS = \d/)
  })
})

describe('bot sweep', () => {
  it('reclaims on heartbeat staleness with a threshold well above the heartbeat interval', () => {
    const bot = read('bot/index.ts')
    const m = bot.match(/const KB_SYNC_STUCK_THRESHOLD_MS = (\d+) \* 60 \* 1000/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(2)
  })
})
