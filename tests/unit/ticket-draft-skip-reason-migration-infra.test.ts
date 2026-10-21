import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { tickets } from '@/lib/db/schema'

// Guards the deploy-time parts of the ticket draft-skip-reason change: the
// migration file shape, its re-run safety, its ordering in drizzle/, the SQL
// column name agreeing with the Drizzle column, and the row mapper default.

const ROOT = process.cwd()
const DRIZZLE_DIR = path.join(ROOT, 'drizzle')
const MIGRATION = '0058_ticket_draft_skip_reason.sql'

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8')
}
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--') || l.trim() === '--> statement-breakpoint')
    .join('\n')
}
function statements(): string[] {
  return stripComments(read(`drizzle/${MIGRATION}`))
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('0058 migration file', () => {
  it('exists and is non-empty', () => {
    const p = path.join(DRIZZLE_DIR, MIGRATION)
    expect(fs.existsSync(p)).toBe(true)
    expect(fs.statSync(p).size).toBeGreaterThan(0)
  })

  it('splits on statement-breakpoint into exactly the ALTER then the backfill UPDATE', () => {
    const s = statements()
    expect(s).toHaveLength(2)
    expect(s[0]).toMatch(/^ALTER TABLE tickets\b/i)
    expect(s[1]).toMatch(/^UPDATE tickets\b/i)
  })

  it('adds the column idempotently as nullable TEXT', () => {
    const alter = statements()[0]
    expect(alter).toMatch(/ADD COLUMN IF NOT EXISTS ai_draft_skip_reason TEXT\s*;?$/i)
    expect(alter).not.toMatch(/NOT NULL|DEFAULT/i)
  })

  it('does not drop or delete anything', () => {
    expect(stripComments(read(`drizzle/${MIGRATION}`))).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT)\b/i)
  })
})

describe('0058 backfill', () => {
  const update = () => statements()[1].replace(/\s+/g, ' ')

  it('only sets the bug_or_feature reason', () => {
    expect(update()).toMatch(/^UPDATE tickets SET ai_draft_skip_reason = 'bug_or_feature' WHERE /)
    expect(update().match(/SET /g)).toHaveLength(1)
  })

  it('is restricted to needs_human tickets with no draft and no reason yet', () => {
    const u = update()
    expect(u).toContain("ai_draft_status = 'needs_human'")
    expect(u).toContain('ai_draft IS NULL')
    // Null-reason guard is what makes a re-run a no-op and protects reasons set at runtime.
    expect(u).toContain('ai_draft_skip_reason IS NULL')
  })

  it('excludes email tickets (held-for-unverified-sender cannot be told apart)', () => {
    expect(update()).toContain("source_platform <> 'email'")
  })

  it('only covers bug and feature_request categories', () => {
    const m = update().match(/category IN \(([^)]*)\)/)
    expect(m).not.toBeNull()
    const cats = m![1].split(',').map((c) => c.trim().replace(/'/g, '')).sort()
    expect(cats).toEqual(['bug', 'feature_request'])
  })

  it('is safe to re-run: the only filtered-in rows are ones the backfill itself makes ineligible', () => {
    const u = update()
    // Rows it writes have a non-null reason, which the IS NULL guard excludes next time.
    expect(u).toContain("= 'bug_or_feature'")
    expect(u).toContain('ai_draft_skip_reason IS NULL')
  })
})

describe('migration ordering in drizzle/', () => {
  const files = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql')).sort()

  it('runs after 0057', () => {
    const prev = files.find((f) => f.startsWith('0057_'))
    expect(prev).toBeDefined()
    expect(files.indexOf(MIGRATION)).toBeGreaterThan(files.indexOf(prev!))
  })

  it('has no duplicate numeric prefixes', () => {
    const seen = new Map<string, string>()
    for (const f of files) {
      const prefix = f.split('_')[0]
      expect(prefix, `${f} has no numeric prefix`).toMatch(/^\d{4}$/)
      expect(seen.get(prefix), `${f} collides with ${seen.get(prefix)}`).toBeUndefined()
      seen.set(prefix, f)
    }
  })

  it('has no gaps in numbering', () => {
    const nums = files.map((f) => Number(f.split('_')[0]))
    nums.forEach((n, i) => expect(n, `gap before ${files[i]}`).toBe(i))
  })
})

describe('Drizzle schema agrees with the SQL column', () => {
  it('tickets.aiDraftSkipReason maps to the column name the migration adds', () => {
    const col = getTableConfig(tickets).columns.find((c) => c.name === 'ai_draft_skip_reason')
    expect(col).toBeDefined()
    expect(col!.getSQLType()).toBe('text')
    expect(col!.notNull).toBe(false)
    expect(col!.hasDefault).toBe(false)
    expect(statements()[0]).toContain(col!.name)
    expect(statements()[1]).toContain(col!.name)
  })

  it('the property key is aiDraftSkipReason (what the mapper and queries read)', () => {
    expect(Object.keys(tickets)).toContain('aiDraftSkipReason')
    expect(tickets.aiDraftSkipReason.name).toBe('ai_draft_skip_reason')
  })

  it('every table column the backfill filters on exists in the schema', () => {
    const names = getTableConfig(tickets).columns.map((c) => c.name)
    for (const c of ['ai_draft_status', 'ai_draft', 'ai_draft_skip_reason', 'source_platform', 'category']) {
      expect(names).toContain(c)
    }
  })
})

describe('toTicket row mapper default (not exported; asserted via source)', () => {
  const src = read('lib/db/queries/tickets.ts')

  it('maps a missing aiDraftSkipReason to null', () => {
    expect(src).toMatch(/ai_draft_skip_reason:\s*\(row\.aiDraftSkipReason \?\? null\) as Ticket\['ai_draft_skip_reason'\]/)
  })

  it('the Ticket type allows null for the field', () => {
    expect(read('types/index.ts')).toMatch(/ai_draft_skip_reason:\s*AIDraftSkipReason \| null/)
  })
})

describe('skip reason recorders', () => {
  it('email ingest records unverified_sender when holding for a person', () => {
    expect(read('app/api/email/ingest/route.ts')).toMatch(
      /updateTicketAIDraftStatus\([^)]*'needs_human',\s*undefined,\s*'unverified_sender'\)/,
    )
  })

  it('agent records bug_or_feature and forwards provider skip reasons', () => {
    const agent = read('lib/ai/agent.ts')
    expect(agent).toContain("'bug_or_feature'")
    expect(agent).toMatch(/updateTicketAIDraftStatus\(ticketId, 'needs_human', undefined, skipReason\)/)
    expect(agent).toMatch(/updateTicketAIDraftStatus\(ticketId, 'needs_human', undefined, err\.skipReason\)/)
  })
})
