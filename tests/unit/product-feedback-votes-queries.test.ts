import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest'
import type { BoardFeedback } from '@/lib/product-feedback/validation'

// The up-vote rules live in one query. Unit tests here run without a database
// (repo convention), so they pin only how the function maps the database's
// answer to a result. The rules themselves (approved entries only, not your
// own, one vote per person, adding and removing safe to repeat, the sort
// before the row cap, tie order) are proven on real Postgres in
// e2e/product-feedback.spec.ts, so nothing here matches SQL text.

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => ({ getDb }))

import { setProductFeedbackVote } from '@/lib/db/queries/product-feedback'

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

  it('adds when the entry qualified — one statement, no second read', async () => {
    const { execute, select, del } = fakeDb([{ id: 12 }], [])
    await expect(setProductFeedbackVote({ ...VIEWER, voted: true })).resolves.toBe('added')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(select).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('an existing vote is success too: the conflict clause hands the row back, so a doubled or retried add reads the same as a fresh one', async () => {
    // From the function's point of view there is no difference: the statement
    // returned a row. The e2e burst case proves the database side of that.
    const { select } = fakeDb([{ id: 12 }], [{ id: 12 }])
    await expect(setProductFeedbackVote({ ...VIEWER, voted: true })).resolves.toBe('added')
    expect(select).not.toHaveBeenCalled()
  })

  it('refuses when the statement returns nothing — the rule said no, including an entry un-approved since the card was drawn', async () => {
    // Before, a row left over from an earlier vote on a now-pending entry made
    // this read "added". There is no row check to be fooled now.
    const { select } = fakeDb([], [{ id: 12 }])
    await expect(setProductFeedbackVote({ ...VIEWER, voted: true })).resolves.toBe('refused')
    expect(select).not.toHaveBeenCalled()
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
