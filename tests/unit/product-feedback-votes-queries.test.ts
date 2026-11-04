import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { BoardFeedback } from '@/lib/product-feedback/validation'

// The up-vote rules live in one query: add only where the entry is approved
// and not the viewer's own, retract when the viewer already voted. Unit tests
// here run without a database (repo convention), so they pin the branch logic
// against a fake transaction and the predicate against the source; the rules
// themselves are proven on real Postgres in e2e/product-feedback.spec.ts.

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))

import { setProductFeedbackVote } from '@/lib/db/queries/product-feedback'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
const flat = (s: string) => s.replace(/\s+/g, ' ')

function fakeDb(insertRows: { id: number }[], existingRows: { id: number }[]) {
  const where = vi.fn(async () => undefined)
  const del = vi.fn(() => ({ where }))
  const execute = vi.fn(async () => insertRows)
  const limit = vi.fn(async () => existingRows)
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }))
  getDb.mockReturnValue({ delete: del, execute, select })
  return { del, execute, select }
}

const VIEWER = { feedbackId: 7, userId: 42, orgId: 3 }

describe('setProductFeedbackVote', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removing is a plain delete and reports the final state, whether or not a row existed', async () => {
    const { del, execute } = fakeDb([], [])
    await expect(setProductFeedbackVote({ ...VIEWER, voted: false })).resolves.toBe('removed')
    expect(del).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it('adds when the entry qualified', async () => {
    const { execute, select } = fakeDb([{ id: 12 }], [])
    await expect(setProductFeedbackVote({ ...VIEWER, voted: true })).resolves.toBe('added')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(select).not.toHaveBeenCalled()
  })

  it('treats an existing vote as success — a doubled or retried add changes nothing and is not an error', async () => {
    const { del } = fakeDb([], [{ id: 12 }])
    await expect(setProductFeedbackVote({ ...VIEWER, voted: true })).resolves.toBe('added')
    expect(del).not.toHaveBeenCalled()
  })

  it('refuses when nothing was written and no vote exists — the rule said no', async () => {
    fakeDb([], [])
    await expect(setProductFeedbackVote({ ...VIEWER, voted: true })).resolves.toBe('refused')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a hostile feedback id %j before touching the database, in both directions',
    async (feedbackId) => {
      fakeDb([{ id: 1 }], [{ id: 1 }])
      await expect(setProductFeedbackVote({ ...VIEWER, feedbackId, voted: true })).resolves.toBe('refused')
      await expect(setProductFeedbackVote({ ...VIEWER, feedbackId, voted: false })).resolves.toBe('refused')
      expect(getDb).not.toHaveBeenCalled()
    },
  )
})

describe('the rule is in the SQL, not only in the component', () => {
  const src = read('lib/db/queries/product-feedback.ts')
  const start = src.indexOf('export async function setProductFeedbackVote')
  const toggle = flat(src.slice(start, src.indexOf('\n}\n', start)))

  it('adds only where the entry is approved and not the viewer own', () => {
    expect(toggle).toContain("${productFeedback.status} = 'approved'")
    expect(toggle).toContain('${productFeedback.userId} IS DISTINCT FROM ${input.userId}')
  })

  it('writes the voter workspace and lets the unique constraint settle a racing duplicate', () => {
    expect(toggle).toContain('INSERT INTO ${productFeedbackVotes} (feedback_id, user_id, org_id)')
    expect(toggle).toContain('ON CONFLICT DO NOTHING')
    // Each statement stands alone; nothing here pretends a transaction serialises clicks.
    expect(toggle).not.toContain('.transaction(')
  })

  it('the snapshot computes the count and the viewer flag, and still filters by the original predicate', () => {
    const snapshot = flat(src.slice(src.indexOf('export async function getBoardSnapshot'), src.indexOf('export async function createProductFeedback')))
    expect(snapshot).toContain('const voteCount = sql<number>`(SELECT COUNT(*)::int FROM ${productFeedbackVotes}')
    // The order is decided in the database, before the row cap.
    expect(snapshot).toContain("input.sort === 'votes' ? [desc(voteCount), desc(productFeedback.createdAt)] : [desc(productFeedback.createdAt)]")
    expect(snapshot.indexOf('.orderBy(...order)')).toBeLessThan(snapshot.indexOf('.limit(200)'))
    expect(snapshot).toContain('viewerVoted: sql<boolean>`EXISTS (SELECT 1 FROM ${productFeedbackVotes}')
    expect(snapshot).toContain("or(eq(productFeedback.status, 'approved'), eq(productFeedback.userId, input.userId))")
  })
})

describe('wire shape stays anonymous', () => {
  it('carries a count and the viewer flag, never a voter id', () => {
    expectTypeOf<BoardFeedback>().toHaveProperty('voteCount').toBeNumber()
    expectTypeOf<BoardFeedback>().toHaveProperty('viewerVoted').toBeBoolean()
    expectTypeOf<BoardFeedback>().not.toHaveProperty('userId')
    expectTypeOf<BoardFeedback>().not.toHaveProperty('voterIds')
    expectTypeOf<BoardFeedback>().not.toHaveProperty('votes')
  })
})
