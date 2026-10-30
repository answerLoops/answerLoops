// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

// Backfill of GitHub comment tickets made before threading: a comment whose
// issue has a ticket becomes a message on it, anything else is left alone, and
// nothing crosses organizations. The statements are compiled by drizzle's
// pg-proxy driver, so the SQL is the real SQL with no database behind it.

type Call = { sql: string; params: unknown[] }
const h = vi.hoisted(() => ({
  getTicketByThreadId: vi.fn(),
  deleteTicket: vi.fn(),
}))
vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketByThreadId: h.getTicketByThreadId,
  deleteTicket: h.deleteTicket,
}))
vi.mock('@/lib/github/app', () => ({ getInstallationOctokitById: vi.fn() }))

// Row order matches the select in thread-backfill.ts.
const orphanRow = (id: number, commentId: number, channel = 'my-org/my-repo', author = 'bob') =>
  [id, `comment ${commentId}`, `github-issue-comment-${channel.replace('/', '-')}-${commentId}`, channel, author, '2026-10-01T00:00:00.000Z']

async function run(opts: {
  orphans: unknown[][]
  repliesOn?: Record<number, number>
  resolve: (ref: { commentId: string }) => Promise<number | null>
  orgId?: number
  dryRun?: boolean
}) {
  const calls: Call[] = []
  const fakeDb = drizzle(async (sqlText: string, params: unknown[]) => {
    calls.push({ sql: sqlText, params })
    const q = sqlText.toLowerCase()
    if (q.startsWith('select count')) return { rows: [[opts.repliesOn?.[params[0] as number] ?? 0]] }
    if (q.startsWith('select')) return { rows: opts.orphans }
    return { rows: [] }
  })
  vi.doMock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))
  vi.resetModules()
  const mod = await import('@/lib/github/thread-backfill')
  const summary = await mod.backfillGithubCommentThreads(opts.orgId ?? 4, opts.resolve as never, { dryRun: opts.dryRun })
  return { calls, summary }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getTicketByThreadId.mockResolvedValue({ id: 50 })
})

describe('parseCommentTicket', () => {
  it('reads owner and repo from the channel, so hyphens in either do not confuse it', async () => {
    const { parseCommentTicket } = await import('@/lib/github/thread-backfill')
    expect(parseCommentTicket('github-issue-comment-my-org-my-repo-123', 'my-org/my-repo')).toEqual({
      owner: 'my-org', repo: 'my-repo', commentId: '123', kind: 'issue',
    })
    expect(parseCommentTicket('github-discussion-comment-o-r-9', 'o/r')).toMatchObject({ kind: 'discussion', commentId: '9' })
  })

  it('returns null for an id that does not match the channel or has no numeric comment id', async () => {
    const { parseCommentTicket } = await import('@/lib/github/thread-backfill')
    expect(parseCommentTicket('github-issue-comment-o-r-abc', 'o/r')).toBeNull()
    expect(parseCommentTicket('github-issue-comment-o-r-5', 'x/y')).toBeNull()
    expect(parseCommentTicket('github-issue-comment-o-r-5', null)).toBeNull()
    expect(parseCommentTicket('github-issue-o-r-5', 'o/r')).toBeNull()
  })
})

describe('backfillGithubCommentThreads', () => {
  it('moves the comment onto its issue ticket, then removes the stand-alone ticket', async () => {
    const { calls, summary } = await run({ orphans: [orphanRow(7, 111)], resolve: async () => 5 })

    expect(summary).toMatchObject({ attached: 1, noParentTicket: 0, unresolved: 0, hasReplies: 0 })
    expect(h.getTicketByThreadId).toHaveBeenCalledWith('github-issue-my-org-my-repo-5', 4)
    const insert = calls.find((c) => c.sql.toLowerCase().startsWith('insert into "ticket_replies"'))
    expect(insert?.params).toEqual(expect.arrayContaining([50, 'bob', 'comment 111', 'customer', 'github-issue-comment-my-org-my-repo-111']))
    expect(insert?.sql.toLowerCase()).toContain('on conflict do nothing')
    expect(h.deleteTicket).toHaveBeenCalledWith(7)
  })

  it('only reads comment tickets of the organization it was given', async () => {
    const { calls } = await run({ orphans: [], resolve: async () => 5, orgId: 4 })
    const select = calls[0]
    expect(select.sql.toLowerCase()).toMatch(/"org_id" = \$\d+/)
    expect(select.params).toContain(4)
    expect(select.params).toContain('github')
  })

  it('looks for the issue ticket inside the same organization only', async () => {
    await run({ orphans: [orphanRow(7, 111)], resolve: async () => 5, orgId: 9 })
    expect(h.getTicketByThreadId).toHaveBeenCalledWith(expect.any(String), 9)
  })

  it('leaves the comment ticket untouched when the issue has no ticket', async () => {
    h.getTicketByThreadId.mockResolvedValue(null)
    const { calls, summary } = await run({ orphans: [orphanRow(7, 111)], resolve: async () => 5 })
    expect(summary).toMatchObject({ attached: 0, noParentTicket: 1 })
    expect(calls.some((c) => c.sql.toLowerCase().startsWith('insert'))).toBe(false)
    expect(h.deleteTicket).not.toHaveBeenCalled()
  })

  it('leaves it untouched when the comment cannot be looked up, or the lookup throws', async () => {
    const { summary, calls } = await run({
      orphans: [orphanRow(7, 111), orphanRow(8, 222)],
      resolve: async (ref) => { if (ref.commentId === '222') throw new Error('404'); return null },
    })
    expect(summary).toMatchObject({ attached: 0, unresolved: 2 })
    expect(h.getTicketByThreadId).not.toHaveBeenCalled()
    expect(calls.some((c) => c.sql.toLowerCase().startsWith('insert'))).toBe(false)
    expect(h.deleteTicket).not.toHaveBeenCalled()
  })

  it('keeps a comment ticket that already has replies, so none are lost', async () => {
    const { summary } = await run({ orphans: [orphanRow(7, 111)], repliesOn: { 7: 2 }, resolve: async () => 5 })
    expect(summary).toMatchObject({ attached: 0, hasReplies: 1 })
    expect(h.deleteTicket).not.toHaveBeenCalled()
  })

  it('does not attach a ticket to itself', async () => {
    h.getTicketByThreadId.mockResolvedValue({ id: 7 })
    const { summary } = await run({ orphans: [orphanRow(7, 111)], resolve: async () => 5 })
    expect(summary).toMatchObject({ attached: 0, noParentTicket: 1 })
    expect(h.deleteTicket).not.toHaveBeenCalled()
  })

  it('a dry run counts what it would do and changes nothing', async () => {
    const { summary, calls } = await run({ orphans: [orphanRow(7, 111)], resolve: async () => 5, dryRun: true })
    expect(summary).toMatchObject({ attached: 0, wouldAttach: 1 })
    expect(calls.some((c) => c.sql.toLowerCase().startsWith('insert'))).toBe(false)
    expect(h.deleteTicket).not.toHaveBeenCalled()
  })
})
