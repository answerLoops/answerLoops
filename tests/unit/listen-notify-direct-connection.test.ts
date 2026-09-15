import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getDirectDatabaseUrl } from '@/lib/db/direct-url'

// Root-cause fix for a production bug found while debugging live Slack
// ingestion: config hot-reload (bot/index.ts's config_changed LISTEN) and
// the member_joined SSE stream (app/api/events/stream/route.ts) both opened
// their LISTEN connection using DATABASE_URL directly. On Neon (and any
// other pooled Postgres provider), DATABASE_URL is the pooled endpoint —
// PgBouncer in transaction mode can swap the physical backend connection
// between statements, so a NOTIFY fired elsewhere never reliably reaches a
// LISTEN registered on a pooled connection. In practice this meant new
// Slack/Discord config only ever took effect after the bot process
// restarted — every write appeared to succeed, but the running process
// never heard about it. Real behavior confirmed live: a Slack channel
// picker save produced zero "config_changed notification — reloading" log
// lines despite `trg_config_changed` existing and being enabled on the
// `integrations` table.

const ROOT = process.cwd()

function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

describe('getDirectDatabaseUrl', () => {
  const originalDirect = process.env.DIRECT_DATABASE_URL
  const originalDb = process.env.DATABASE_URL

  beforeEach(() => {
    delete process.env.DIRECT_DATABASE_URL
    delete process.env.DATABASE_URL
  })

  afterEach(() => {
    if (originalDirect === undefined) delete process.env.DIRECT_DATABASE_URL
    else process.env.DIRECT_DATABASE_URL = originalDirect
    if (originalDb === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDb
  })

  it('prefers DIRECT_DATABASE_URL when set', () => {
    process.env.DIRECT_DATABASE_URL = 'postgres://direct-host/db'
    process.env.DATABASE_URL = 'postgres://pooled-host-pooler/db'
    expect(getDirectDatabaseUrl()).toBe('postgres://direct-host/db')
  })

  it('falls back to DATABASE_URL when DIRECT_DATABASE_URL is unset — correct for unpooled self-hosted Postgres', () => {
    process.env.DATABASE_URL = 'postgres://plain-postgres/db'
    expect(getDirectDatabaseUrl()).toBe('postgres://plain-postgres/db')
  })

  it('returns undefined when neither is set', () => {
    expect(getDirectDatabaseUrl()).toBeUndefined()
  })
})

describe('LISTEN consumers use the direct connection, not the pooled one', () => {
  it('bot/index.ts LISTEN connection (config_changed, kb_sync_job_queued, ...) resolves via getDirectDatabaseUrl', () => {
    const src = read('bot/index.ts')
    // Generalized from watchConfigChanges to watchNotifications when the KB
    // sync worker moved onto this same connection instead of its own 15s poll.
    const idx = src.indexOf('function watchNotifications')
    const body = src.slice(idx, src.indexOf('\n}', idx))
    expect(body).toContain('getDirectDatabaseUrl()')
    expect(body).not.toContain('process.env.DATABASE_URL')
  })

  it('the member_joined SSE stream resolves via getDirectDatabaseUrl', () => {
    const src = read('app/api/events/stream/route.ts')
    expect(src).toContain('getDirectDatabaseUrl()')
    expect(src).not.toContain('process.env.DATABASE_URL')
  })
})
