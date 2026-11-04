import { describe, it, expect, vi, beforeEach } from 'vitest'

// One click on the up arrow, as the server sees it. Same guard order as the
// submit action: feature flag, real membership, shape of the input, rate
// limit, then the query. Identity always comes from the session — the test
// sends forged ids in the payload to prove they never reach the database.

const requireOrgAccess = vi.fn()
const rateLimitShared = vi.fn()
const q = vi.hoisted(() => ({ createProductFeedback: vi.fn(), toggleProductFeedbackVote: vi.fn() }))
const notify = vi.hoisted(() => ({ sendProductFeedbackNotification: vi.fn() }))

vi.mock('@/lib/email/send', () => notify)
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: () => requireOrgAccess() }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: (...a: unknown[]) => rateLimitShared(...a) }))
vi.mock('@/lib/db/queries/product-feedback', () => q)

import { toggleProductFeedbackVoteAction } from '@/lib/actions/product-feedback'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FEEDBACK_WIDGET_ENABLED = '1'
  requireOrgAccess.mockResolvedValue({ ok: true, orgId: 4, userId: 9, role: 'member' })
  rateLimitShared.mockResolvedValue({ ok: true })
  q.toggleProductFeedbackVote.mockResolvedValue('added')
})

describe('toggleProductFeedbackVoteAction', () => {
  it('votes as the server-resolved user and workspace, ignoring ids in the payload', async () => {
    const res = await toggleProductFeedbackVoteAction({ feedbackId: 7, userId: 999, orgId: 999 })
    expect(res).toEqual({ ok: true, state: 'added' })
    expect(q.toggleProductFeedbackVote).toHaveBeenCalledWith({ feedbackId: 7, userId: 9, orgId: 4 })
  })

  it('reports a retracted vote as removed', async () => {
    q.toggleProductFeedbackVote.mockResolvedValue('removed')
    expect(await toggleProductFeedbackVoteAction({ feedbackId: 7 })).toEqual({ ok: true, state: 'removed' })
  })

  it('turns a refusal into a plain message the card can show', async () => {
    q.toggleProductFeedbackVote.mockResolvedValue('refused')
    const res = await toggleProductFeedbackVoteAction({ feedbackId: 7 })
    expect(res).toEqual({ ok: false, error: 'This entry cannot be voted on.' })
  })

  it('requires a signed-in member before touching the database', async () => {
    requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect(await toggleProductFeedbackVoteAction({ feedbackId: 7 })).toEqual({ ok: false, error: 'Unauthorized' })
    expect(q.toggleProductFeedbackVote).not.toHaveBeenCalled()
  })

  it.each([
    ['a string id', { feedbackId: '7' }],
    ['a negative id', { feedbackId: -1 }],
    ['zero', { feedbackId: 0 }],
    ['a fractional id', { feedbackId: 1.5 }],
    ['NaN', { feedbackId: Number.NaN }],
    ['a missing id', {}],
    ['a non-object', 'feedbackId=7'],
    ['null', null],
  ])('rejects %s before any query', async (_label, input) => {
    expect(await toggleProductFeedbackVoteAction(input)).toEqual({ ok: false, error: 'Invalid input' })
    expect(rateLimitShared).not.toHaveBeenCalled()
    expect(q.toggleProductFeedbackVote).not.toHaveBeenCalled()
  })

  it('rate-limits per user on its own key, generously enough for a toggle', async () => {
    rateLimitShared.mockResolvedValue({ ok: false })
    const res = await toggleProductFeedbackVoteAction({ feedbackId: 7 })
    expect(res).toMatchObject({ ok: false })
    expect(rateLimitShared.mock.calls[0]).toEqual(['product-feedback-vote:9', 60, 60 * 60 * 1000])
    expect(q.toggleProductFeedbackVote).not.toHaveBeenCalled()
  })

  it('never notifies the operator — a vote is not a submission', async () => {
    await toggleProductFeedbackVoteAction({ feedbackId: 7 })
    expect(notify.sendProductFeedbackNotification).not.toHaveBeenCalled()
  })
})

describe('when the widget is not enabled', () => {
  it('voting is refused before any auth or database work', async () => {
    delete process.env.FEEDBACK_WIDGET_ENABLED
    expect(await toggleProductFeedbackVoteAction({ feedbackId: 7 })).toEqual({
      ok: false,
      error: 'Feedback is not available.',
    })
    expect(requireOrgAccess).not.toHaveBeenCalled()
    expect(q.toggleProductFeedbackVote).not.toHaveBeenCalled()
  })
})
