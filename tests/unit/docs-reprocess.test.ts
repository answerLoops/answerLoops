import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// The one-time re-processing of synced repo docs: repos whose docs were
// synced before files were recorded, or under older cleanup rules, are
// queued for a sync, but only for workspaces where that runs on our key at
// no cost to them. Everyone else re-processes on their next push or Sync now.

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  isFree: vi.fn(),
  enqueue: vi.fn(),
}))
vi.mock('@/lib/db/drizzle', () => ({ getDb: () => ({ execute: h.execute }) }))
vi.mock('@/lib/kb/pass-embedder', () => ({ isFreeReprocessCandidate: h.isFree }))
vi.mock('@/lib/db/queries/kb-sync-jobs', () => ({ enqueueKbSyncJob: h.enqueue }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { listReprocessRepos, enqueueDocsReprocess } from '@/lib/github/docs-reprocess'

const dialect = new PgDialect()

beforeEach(() => {
  vi.clearAllMocks()
  h.execute.mockResolvedValue([])
  h.isFree.mockResolvedValue(true)
  h.enqueue.mockResolvedValue({ id: 1, status: 'queued', created: true })
})

describe('listReprocessRepos', () => {
  it('selects knowledge-base repos whose synced docs predate file records or the current rules', async () => {
    h.execute.mockResolvedValue([{ org_id: 7, repo_id: 4 }])
    expect(await listReprocessRepos(25)).toEqual([{ orgId: 7, repoId: 4 }])
    const q = dialect.sqlToQuery(h.execute.mock.calls[0][0] as SQL)
    expect(q.sql).toMatch(/kb_enabled = 1/)
    expect(q.sql).toMatch(/s\.filename = r\.owner \|\| '\/' \|\| r\.repo/)
    expect(q.sql).toMatch(/EXISTS \(SELECT 1 FROM kb_articles a WHERE a\.source_id = s\.id/)
    expect(q.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM kb_source_files f WHERE f\.source_id = s\.id\)/)
    expect(q.sql).toMatch(/f\.processing_version < /)
    // A repo with a sync already queued or running is left to that sync.
    expect(q.sql).toMatch(/status IN \('queued', 'running'\)/)
    // Each repo is tried at most once a day, so one that can't be finished isn't re-queued every hour.
    expect(q.sql).toMatch(/j\.reprocess_only AND j\.created_at::timestamptz > now\(\) - interval '24 hours'/)
    expect(q.params).toEqual(expect.arrayContaining([25]))
  })

  it('skips repos already current', async () => {
    h.execute.mockResolvedValue([])
    expect(await listReprocessRepos()).toEqual([])
  })
})

describe('enqueueDocsReprocess', () => {
  it('keeps only a few re-processing jobs waiting at once', async () => {
    h.execute.mockImplementation(async (q: SQL) => {
      const text = dialect.sqlToQuery(q).sql
      if (/count\(\*\)/.test(text)) return [{ n: 3 }]
      return [1, 2, 3, 4].map((k) => ({ org_id: k, repo_id: k }))
    })
    expect(await enqueueDocsReprocess()).toEqual({ queued: 2 })
    expect(h.enqueue).toHaveBeenCalledTimes(2)
  })

  it('queues free candidates only', async () => {
    h.execute.mockResolvedValue([{ org_id: 7, repo_id: 4 }, { org_id: 8, repo_id: 5 }])
    h.isFree.mockImplementation(async (orgId: number) => orgId === 7)
    expect(await enqueueDocsReprocess()).toEqual({ queued: 1 })
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ orgId: 7, kind: 'github_repo', repoId: 4 }))
  })

  it('uses one-hour cooldown', async () => {
    h.execute.mockResolvedValue([{ org_id: 7, repo_id: 4 }])
    await enqueueDocsReprocess()
    expect(h.enqueue).toHaveBeenCalledWith({ orgId: 7, kind: 'github_repo', repoId: 4, cooldownMs: 60 * 60 * 1000, reprocessOnly: true })
  })

  it('checks each workspace once, and does not count a job that was already queued', async () => {
    h.execute.mockResolvedValue([{ org_id: 7, repo_id: 4 }, { org_id: 7, repo_id: 6 }])
    h.enqueue.mockResolvedValueOnce({ id: 1, status: 'queued', created: true }).mockResolvedValueOnce({ id: 2, status: 'queued', created: false })
    expect(await enqueueDocsReprocess()).toEqual({ queued: 1 })
    expect(h.isFree).toHaveBeenCalledTimes(1)
  })

  it('keeps going when one workspace fails', async () => {
    h.execute.mockResolvedValue([{ org_id: 7, repo_id: 4 }, { org_id: 8, repo_id: 5 }])
    h.isFree.mockImplementation(async (orgId: number) => {
      if (orgId === 7) throw new Error('config unreadable')
      return true
    })
    expect(await enqueueDocsReprocess()).toEqual({ queued: 1 })
  })
})

describe('bot sweep', () => {
  const bot = fs.readFileSync(path.join(process.cwd(), 'bot/index.ts'), 'utf8')

  it('POSTs to the run route with the bot secret on an interval, and is started', () => {
    expect(bot).toContain('function startDocsReprocessSweep(): void')
    expect(bot).toContain('/api/kb/docs-reprocess/run')
    expect(bot).toMatch(/DOCS_REPROCESS_SWEEP_INTERVAL_MS = 15 \* 60 \* 1000/)
    expect(bot).toMatch(/startDocsReprocessSweep\(\)\n/)
  })
})
