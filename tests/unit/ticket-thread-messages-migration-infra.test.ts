import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { ticketReplies } from '@/lib/db/schema'

// Deploy-time guards for the migration that lets a ticket hold a whole
// conversation: it sorts after the last one, re-runs safely, backfills the
// meaning of rows that already exist, and agrees with the Drizzle table and
// the TypeScript role union.

const ROOT = process.cwd()
const MIGRATION = '0064_ticket_thread_messages.sql'
const sql = fs.readFileSync(path.join(ROOT, 'drizzle', MIGRATION), 'utf-8')
const statements = sql
  .split('--> statement-breakpoint')
  .map((s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim())
  .filter(Boolean)

describe(MIGRATION, () => {
  it('sorts after the migration before it and is the only one with its number', () => {
    const numbered = fs.readdirSync(path.join(ROOT, 'drizzle')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
    expect(numbered.filter((f) => f.startsWith('0064_'))).toEqual([MIGRATION])
    expect(numbered[numbered.indexOf(MIGRATION) - 1]).toMatch(/^0063_/)
  })

  it('is safe to run twice', () => {
    for (const s of statements.filter((x) => /^(ALTER TABLE|CREATE)/i.test(x))) {
      expect(s, s).toMatch(/IF NOT EXISTS/i)
    }
  })

  it('adds author_role with a default, so existing rows stay valid, constrained to the three roles', () => {
    const add = statements.find((s) => /ADD COLUMN IF NOT EXISTS author_role/i.test(s))!
    expect(add).toMatch(/TEXT NOT NULL DEFAULT 'staff'/i)
    expect(add).toMatch(/CHECK \(author_role IN \('staff', 'customer', 'context'\)\)/i)
  })

  it('relabels the inbound replies that were all stored under the name Customer, and only those', () => {
    const backfill = statements.find((s) => /^UPDATE ticket_replies/i.test(s))!
    expect(backfill).toMatch(/SET author_role = 'customer'/i)
    expect(backfill).toMatch(/WHERE staff_name = 'Customer' AND author_role = 'staff'/i)
  })

  it('makes a message id unique per ticket, only where one is set', () => {
    const idx = statements.find((s) => /ticket_replies_ticket_source_message_unique/.test(s))!
    expect(idx).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i)
    expect(idx).toMatch(/\(ticket_id, source_message_id\) WHERE source_message_id IS NOT NULL/i)
  })

  it('indexes the lookup a reply to a stored message uses', () => {
    expect(statements.some((s) => /idx_ticket_replies_source_message.*\(source_message_id\) WHERE source_message_id IS NOT NULL/i.test(s))).toBe(true)
  })
})

describe('ticketReplies agrees with the migration', () => {
  it('declares the new columns', () => {
    const cols = getTableColumns(ticketReplies)
    expect(cols.authorRole.name).toBe('author_role')
    expect(cols.authorRole.notNull).toBe(true)
    expect(cols.authorRole.default).toBe('staff')
    expect(cols.sourceMessageId.name).toBe('source_message_id')
    expect(cols.sourceMessageId.notNull).toBe(false)
  })

  it('declares both indexes under the names the SQL creates', () => {
    const { indexes } = getTableConfig(ticketReplies)
    const names = indexes.map((i) => i.config.name)
    expect(names).toContain('ticket_replies_ticket_source_message_unique')
    expect(names).toContain('idx_ticket_replies_source_message')
    expect(indexes.find((i) => i.config.name === 'ticket_replies_ticket_source_message_unique')!.config.unique).toBe(true)
  })

  it('the roles it allows are still named by the TypeScript union (a later migration adds ai)', () => {
    const allowed = /author_role IN \(([^)]+)\)/.exec(sql)![1].match(/'([a-z]+)'/g)!.map((s) => s.replace(/'/g, ''))
    const types = fs.readFileSync(path.join(ROOT, 'types/index.ts'), 'utf-8')
    const union = /type TicketReplyRole = ([^\n]+)/.exec(types)![1].match(/'([a-z]+)'/g)!.map((s) => s.replace(/'/g, ''))
    expect(union.filter((r) => r !== 'ai').sort()).toEqual(allowed.sort())
  })
})
