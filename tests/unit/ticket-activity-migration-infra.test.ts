// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(join(process.cwd(), 'drizzle/0069_ticket_activity.sql'), 'utf8')
const schema = readFileSync(join(process.cwd(), 'lib/db/schema.ts'), 'utf8')
const flat = sql.replace(/\s+/g, ' ')

describe('0069_ticket_activity migration', () => {
  it('adds the three activity columns', () => {
    expect(flat).toMatch(/ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;/)
    expect(flat).toMatch(/ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_customer_reply_at TIMESTAMPTZ;/)
    expect(flat).toMatch(/ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;/)
  })

  it('backfills last_seen_at in the same UPDATE so history is not new activity', () => {
    const update = flat.match(/UPDATE tickets t SET (.*?)WHERE t\.last_activity_at IS NULL;/)
    expect(update).not.toBeNull()
    expect(update![1]).toContain('last_seen_at =')
    expect(update![1]).toContain('last_customer_reply_at =')
    expect(update![1]).toContain('last_activity_at =')
  })

  it('makes last_activity_at NOT NULL only after the backfill, with a default', () => {
    const backfill = sql.indexOf('UPDATE tickets t')
    const notNull = sql.indexOf('ALTER COLUMN last_activity_at SET NOT NULL')
    expect(backfill).toBeGreaterThan(-1)
    expect(notNull).toBeGreaterThan(backfill)
    expect(flat).toContain('ALTER COLUMN last_activity_at SET DEFAULT')
  })

  it('creates the org activity index', () => {
    expect(flat).toMatch(/CREATE INDEX IF NOT EXISTS idx_tickets_org_last_activity ON tickets \(org_id, last_activity_at DESC, id DESC\)/)
  })

  it('separates statements with breakpoints', () => {
    expect(sql.match(/--> statement-breakpoint/g)!.length).toBeGreaterThanOrEqual(6)
  })
})

describe('tickets schema', () => {
  it('declares the three activity columns', () => {
    expect(schema).toMatch(/lastActivityAt: timestamp\('last_activity_at', \{ withTimezone: true \}\)\.notNull\(\)/)
    expect(schema).toMatch(/lastCustomerReplyAt: timestamp\('last_customer_reply_at', \{ withTimezone: true \}\)/)
    expect(schema).toMatch(/lastSeenAt: timestamp\('last_seen_at', \{ withTimezone: true \}\)/)
  })
})
