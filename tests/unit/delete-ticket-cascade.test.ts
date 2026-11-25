import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Real bug found live: deleteTicket only ever cleared 3 of the ~9 tables
// that reference a ticket with no cascade/set-null action at the DB level
// (ticket_replies, ticket_events, ai_assessments) — notifications,
// ticket_embeddings, ticket_links (both its ticketId and relatedId
// columns), ticket_feedback, answer_messages, csat_messages, and
// csat_ratings were all missing. Any ticket that ever had a notification
// fired — which is effectively every ticket, since one fires on creation
// alone — failed this call outright with a foreign-key violation from the
// dashboard's own owner-only Delete button. Confirmed live while bulk-
// cleaning up test tickets: a raw multi-table DELETE hit exactly this
// error on the notifications table.
//
// Fixed by mirroring the dependency-safe order hardPurgeOrg
// (lib/db/queries/orgs.ts) already uses for org-wide deletion, scoped to
// a single ticket and wrapped in a transaction. kb_articles.source_ticket_id
// is nullable and represents real KB content this ticket was promoted
// into, so it's detached (set null), never deleted along with the ticket.

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))

describe('lib/db/queries/tickets.ts — deleteTicket clears every table that references a ticket', () => {
  it('clears every dependent table the schema actually declares a tickets.id FK on', () => {
    const schemaSrc = read('lib/db/schema.ts')
    const fnSrc = read('lib/db/queries/tickets.ts')
    const fnIdx = fnSrc.indexOf('export async function deleteTicket')
    const fnBody = fnSrc.slice(fnIdx, fnSrc.indexOf('\n}', fnIdx))

    // Every table declaring a tickets.id FK, per the schema itself — the
    // list this test checks against isn't hand-maintained separately, so
    // it can't silently drift out of sync with a newly added FK.
    const referencingTables = [...schemaSrc.matchAll(/export const (\w+) = pgTable\(\s*'?"?(\w+)"?'?/g)]
    const tablesWithTicketFk = new Set<string>()
    for (const m of schemaSrc.matchAll(/export const (\w+) = pgTable/g)) {
      tablesWithTicketFk.add(m[1])
    }
    // Cross-check: every one of these known FK sites must appear in deleteTicket
    const expectedVars = [
      'notifications', 'ticketEmbeddings', 'ticketLinks', 'ticketFeedback',
      'answerMessages', 'csatMessages', 'csatRatings', 'ticketReplies',
      'ticketEvents', 'aiAssessments', 'kbArticles', 'tickets',
    ]
    for (const varName of expectedVars) {
      expect(fnBody, `deleteTicket must reference ${varName}`).toContain(varName)
    }
    void referencingTables
  })

  it('detaches kb_articles.source_ticket_id (sets null) rather than deleting the KB article', () => {
    const src = read('lib/db/queries/tickets.ts')
    const fnIdx = src.indexOf('export async function deleteTicket')
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnBody).toContain('tx.update(kbArticles).set({ sourceTicketId: null })')
    expect(fnBody).not.toMatch(/tx\.delete\(kbArticles\)/)
  })

  it('deletes both ticketLinks columns — a ticket can be the "related" side of another ticket too', () => {
    const src = read('lib/db/queries/tickets.ts')
    const fnIdx = src.indexOf('export async function deleteTicket')
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnBody).toContain('tx.delete(ticketLinks).where(eq(ticketLinks.ticketId, id))')
    expect(fnBody).toContain('tx.delete(ticketLinks).where(eq(ticketLinks.relatedId, id))')
  })

  it('wraps every delete in a single transaction, not independent statements', () => {
    const src = read('lib/db/queries/tickets.ts')
    const fnIdx = src.indexOf('export async function deleteTicket')
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnBody).toContain('db.transaction(async (tx) =>')
  })
})

describe('deleteTicket: behavioral — actually issues a DELETE against every dependent table', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls delete/update on every dependent table before deleting the ticket row itself', async () => {
    const calledOn: string[] = []
    const fakeTable = (name: string) => ({ __name: name })
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ orgId: 3 }] }) }) }),
      execute: async () => { calledOn.push('lock:workspace') },
      update: (table: { __name: string }) => {
        calledOn.push(`update:${table.__name}`)
        return { set: () => ({ where: () => Promise.resolve() }) }
      },
      delete: (table: { __name: string }) => {
        calledOn.push(`delete:${table.__name}`)
        return { where: () => Promise.resolve() }
      },
    }
    getDb.mockReturnValue({
      transaction: async (fn: (tx: unknown) => Promise<void>) => fn(tx),
    })

    vi.doMock('@/lib/db/schema', () => ({
      tickets: fakeTable('tickets'),
      ticketReplies: fakeTable('ticketReplies'),
      ticketEvents: fakeTable('ticketEvents'),
      aiAssessments: fakeTable('aiAssessments'),
      orgs: fakeTable('orgs'),
      notifications: fakeTable('notifications'),
      ticketEmbeddings: fakeTable('ticketEmbeddings'),
      ticketLinks: fakeTable('ticketLinks'),
      ticketFeedback: fakeTable('ticketFeedback'),
      answerMessages: fakeTable('answerMessages'),
      csatMessages: fakeTable('csatMessages'),
      csatRatings: fakeTable('csatRatings'),
      kbArticles: fakeTable('kbArticles'),
    }))
    vi.resetModules()

    const { deleteTicket } = await import('@/lib/db/queries/tickets')
    await deleteTicket(42)

    // The ticket row itself must be deleted last, after every dependent
    // table — deleting it first would violate the FK constraints this bug
    // was all about in the first place.
    const ticketDeleteIdx = calledOn.indexOf('delete:tickets')
    expect(calledOn[0]).toBe('lock:workspace')
    expect(ticketDeleteIdx).toBe(calledOn.length - 1)
    expect(calledOn).toContain('update:kbArticles')
    expect(calledOn).toContain('delete:notifications')
    expect(calledOn).toContain('delete:ticketEmbeddings')
    expect(calledOn.filter((c) => c === 'delete:ticketLinks')).toHaveLength(2)
    expect(calledOn).toContain('delete:ticketFeedback')
    expect(calledOn).toContain('delete:answerMessages')
    expect(calledOn).toContain('delete:csatMessages')
    expect(calledOn).toContain('delete:csatRatings')
    expect(calledOn).toContain('delete:ticketReplies')
    expect(calledOn).toContain('delete:ticketEvents')
    expect(calledOn).toContain('delete:aiAssessments')
  })
})
