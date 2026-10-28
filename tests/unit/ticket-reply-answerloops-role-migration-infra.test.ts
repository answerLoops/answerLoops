import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Deploy-time guards for the migration that lets a ticket's conversation hold
// answerLoops's own replies: it sorts last, re-runs safely, widens the role
// check without dropping any existing role, and agrees with the TypeScript
// role union.

const ROOT = process.cwd()
const MIGRATION = '0065_ticket_reply_answerloops_role.sql'
const sql = fs.readFileSync(path.join(ROOT, 'drizzle', MIGRATION), 'utf-8')
const statements = sql
  .split('--> statement-breakpoint')
  .map((s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim())
  .filter(Boolean)

const quoted = (list: string) => list.match(/'([a-z]+)'/g)!.map((s) => s.replace(/'/g, ''))

describe(MIGRATION, () => {
  it('sorts directly after the thread-messages migration and is the only one with its number', () => {
    const numbered = fs.readdirSync(path.join(ROOT, 'drizzle')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
    expect(numbered.filter((f) => f.startsWith('0065_'))).toEqual([MIGRATION])
    expect(numbered[numbered.indexOf(MIGRATION) - 1]).toBe('0064_ticket_thread_messages.sql')
  })

  it('is safe to run twice: the old check is dropped only if it exists, then the new one added', () => {
    expect(statements).toHaveLength(2)
    expect(statements[0]).toMatch(/^ALTER TABLE ticket_replies DROP CONSTRAINT IF EXISTS ticket_replies_author_role_check;?$/i)
    expect(statements[1]).toMatch(/^ALTER TABLE ticket_replies ADD CONSTRAINT ticket_replies_author_role_check CHECK/i)
  })

  it('replaces the check under the name the earlier migration gave it, so no second check is left behind', () => {
    // 0064 added the column with an inline CHECK, which Postgres names <table>_<column>_check.
    expect(sql).toContain('ticket_replies_author_role_check')
  })

  it('keeps every role the earlier check allowed and adds ai', () => {
    const earlier = quoted(/author_role IN \(([^)]+)\)/.exec(fs.readFileSync(path.join(ROOT, 'drizzle', '0064_ticket_thread_messages.sql'), 'utf-8'))![1])
    const now = quoted(/author_role IN \(([^)]+)\)/.exec(sql)![1])
    for (const role of earlier) expect(now).toContain(role)
    expect(now).toContain('ai')
    expect(now).toHaveLength(earlier.length + 1)
  })

  it('allows exactly the roles the TypeScript union names', () => {
    const allowed = quoted(/author_role IN \(([^)]+)\)/.exec(sql)![1])
    const types = fs.readFileSync(path.join(ROOT, 'types/index.ts'), 'utf-8')
    const union = quoted(/type TicketReplyRole = ([^\n]+)/.exec(types)![1])
    expect(union.sort()).toEqual(allowed.sort())
  })

  it('does not rewrite any existing row', () => {
    expect(statements.some((s) => /^(UPDATE|DELETE|INSERT)/i.test(s))).toBe(false)
  })
})
