import { describe, it, expect, vi, beforeEach } from 'vitest'

// One click on the up arrow, as the server sees it: the request names the
// state the person wants. Same guard order as the
// submit action: feature flag, real membership, shape of the input, rate
// limit, then the query. Identity always comes from the session — the test
// sends forged ids in the payload to prove they never reach the database.

const requireOrgAccess = vi.fn()
const rateLimitShared = vi.fn()
const q = vi.hoisted(() => ({ createProductFeedback: vi.fn(), setProductFeedbackVote: vi.fn() }))
const notify = vi.hoisted(() => ({ sendProductFeedbackNotification: vi.fn() }))

vi.mock('@/lib/email/send', () => notify)
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: () => requireOrgAccess() }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: (...a: unknown[]) => rateLimitShared(...a) }))
vi.mock('@/lib/db/queries/product-feedback', () => q)

import { voteProductFeedbackAction } from '@/lib/actions/product-feedback'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FEEDBACK_WIDGET_ENABLED = '1'
  requireOrgAccess.mockResolvedValue({ ok: true, orgId: 4, userId: 9, role: 'member' })
  rateLimitShared.mockResolvedValue({ ok: true })
  q.setProductFeedbackVote.mockResolvedValue('added')
})

describe('voteProductFeedbackAction', () => {
  it('votes as the server-resolved user and workspace, ignoring ids in the payload', async () => {
    const res = await voteProductFeedbackAction({ feedbackId: 7, voted: true, userId: 999, orgId: 999 })
    expect(res).toEqual({ ok: true, state: 'added' })
    expect(q.setProductFeedbackVote).toHaveBeenCalledWith({ feedbackId: 7, userId: 9, orgId: 4, voted: true })
  })

  it('passes the wanted state through, so removing is explicit', async () => {
    q.setProductFeedbackVote.mockResolvedValue('removed')
    expect(await voteProductFeedbackAction({ feedbackId: 7, voted: false })).toEqual({ ok: true, state: 'removed' })
    expect(q.setProductFeedbackVote).toHaveBeenCalledWith({ feedbackId: 7, userId: 9, orgId: 4, voted: false })
  })

  it('turns a refusal into a plain message the card can show', async () => {
    q.setProductFeedbackVote.mockResolvedValue('refused')
    const res = await voteProductFeedbackAction({ feedbackId: 7, voted: true })
    expect(res).toEqual({ ok: false, error: 'This entry cannot be voted on.' })
  })

  it('requires a signed-in member before touching the database', async () => {
    requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect(await voteProductFeedbackAction({ feedbackId: 7, voted: true })).toEqual({ ok: false, error: 'Unauthorized' })
    expect(q.setProductFeedbackVote).not.toHaveBeenCalled()
  })

  it.each([
    ['a string id', { feedbackId: '7', voted: true }],
    ['a negative id', { feedbackId: -1, voted: true }],
    ['zero', { feedbackId: 0, voted: true }],
    ['a fractional id', { feedbackId: 1.5, voted: true }],
    ['NaN', { feedbackId: Number.NaN, voted: true }],
    ['an id past the integer column', { feedbackId: 2_147_483_648, voted: true }],
    ['a missing state', { feedbackId: 7 }],
    ['a string state', { feedbackId: 7, voted: 'yes' }],
    ['a missing id', { voted: true }],
    ['a non-object', 'feedbackId=7'],
    ['null', null],
  ])('rejects %s before any query', async (_label, input) => {
    expect(await voteProductFeedbackAction(input)).toEqual({ ok: false, error: 'Invalid input' })
    expect(rateLimitShared).not.toHaveBeenCalled()
    expect(q.setProductFeedbackVote).not.toHaveBeenCalled()
  })

  it('rate-limits per user on its own key, generously enough for a toggle', async () => {
    rateLimitShared.mockResolvedValue({ ok: false })
    const res = await voteProductFeedbackAction({ feedbackId: 7, voted: true })
    expect(res).toMatchObject({ ok: false })
    expect(rateLimitShared.mock.calls[0]).toEqual(['product-feedback-vote:9', 60, 60 * 60 * 1000])
    expect(q.setProductFeedbackVote).not.toHaveBeenCalled()
  })

  it('never notifies the operator — a vote is not a submission', async () => {
    await voteProductFeedbackAction({ feedbackId: 7, voted: true })
    expect(notify.sendProductFeedbackNotification).not.toHaveBeenCalled()
  })
})

describe('when the widget is not enabled', () => {
  it('voting is refused before any auth or database work', async () => {
    delete process.env.FEEDBACK_WIDGET_ENABLED
    expect(await voteProductFeedbackAction({ feedbackId: 7, voted: true })).toEqual({
      ok: false,
      error: 'Feedback is not available.',
    })
    expect(requireOrgAccess).not.toHaveBeenCalled()
    expect(q.setProductFeedbackVote).not.toHaveBeenCalled()
  })
})
