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

import { toggleProductFeedbackVote } from '@/lib/db/queries/product-feedback'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
const flat = (s: string) => s.replace(/\s+/g, ' ')

function fakeTx(deleteRows: { id: number }[], executeRows: { id: number }[]) {
  const returning = vi.fn(async () => deleteRows)
  const where = vi.fn(() => ({ returning }))
  const del = vi.fn(() => ({ where }))
  const execute = vi.fn(async () => executeRows)
  const tx = { delete: del, execute }
  getDb.mockReturnValue({ transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) })
  return { del, execute }
}

const VIEWER = { feedbackId: 7, userId: 42, orgId: 3 }

describe('toggleProductFeedbackVote', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retracts when the viewer already voted, and never tries to add', async () => {
    const { del, execute } = fakeTx([{ id: 11 }], [])
    await expect(toggleProductFeedbackVote(VIEWER)).resolves.toBe('removed')
    expect(del).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it('adds when no vote existed and the entry qualified', async () => {
    const { execute } = fakeTx([], [{ id: 12 }])
    await expect(toggleProductFeedbackVote(VIEWER)).resolves.toBe('added')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('refuses when no vote existed and the insert predicate matched nothing', async () => {
    fakeTx([], [])
    await expect(toggleProductFeedbackVote(VIEWER)).resolves.toBe('refused')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a hostile feedback id %j before touching the database',
    async (feedbackId) => {
      fakeTx([{ id: 1 }], [{ id: 1 }])
      await expect(toggleProductFeedbackVote({ ...VIEWER, feedbackId })).resolves.toBe('refused')
      expect(getDb).not.toHaveBeenCalled()
    },
  )
})

describe('the rule is in the SQL, not only in the component', () => {
  const src = read('lib/db/queries/product-feedback.ts')
  const start = src.indexOf('export async function toggleProductFeedbackVote')
  const toggle = flat(src.slice(start, src.indexOf('\n}\n', start)))

  it('adds only where the entry is approved and not the viewer own', () => {
    expect(toggle).toContain("${productFeedback.status} = 'approved'")
    expect(toggle).toContain('${productFeedback.userId} IS DISTINCT FROM ${input.userId}')
  })

  it('writes the voter workspace, tolerates a racing duplicate, and runs in one transaction', () => {
    expect(toggle).toContain('INSERT INTO ${productFeedbackVotes} (feedback_id, user_id, org_id)')
    expect(toggle).toContain('ON CONFLICT DO NOTHING')
    expect(toggle).toContain('.transaction(')
  })

  it('the snapshot computes the count and the viewer flag, and still filters by the original predicate', () => {
    const snapshot = flat(src.slice(src.indexOf('export async function getBoardSnapshot'), src.indexOf('export async function createProductFeedback')))
    expect(snapshot).toContain('voteCount: sql<number>`(SELECT COUNT(*)::int FROM ${productFeedbackVotes}')
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
