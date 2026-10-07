import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireOrgAccess = vi.fn()
const rateLimitShared = vi.fn()
const q = vi.hoisted(() => ({ createProductFeedback: vi.fn() }))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: () => requireOrgAccess() }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: (...a: unknown[]) => rateLimitShared(...a) }))
vi.mock('@/lib/db/queries/product-feedback', () => q)

import * as actions from '@/lib/actions/product-feedback'
import { submitProductFeedbackAction } from '@/lib/actions/product-feedback'

const GOOD = 'The new dashboard is great and saves our team a lot of time.'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FEEDBACK_WIDGET_ENABLED = '1'
  requireOrgAccess.mockResolvedValue({ ok: true, orgId: 4, userId: 9, role: 'member' })
  rateLimitShared.mockResolvedValue({ ok: true })
  q.createProductFeedback.mockResolvedValue(1)
})

describe('submitProductFeedbackAction', () => {
  it('stores feedback against the server-resolved org and user, trimmed', async () => {
    const res = await submitProductFeedbackAction({ body: `  ${GOOD}  `, anonymous: true, orgId: 999 })
    expect(res).toEqual({ ok: true })
    expect(q.createProductFeedback).toHaveBeenCalledWith({
      orgId: 4,
      userId: 9,
      body: GOOD,
      anonymous: true,
    })
  })

  it('requires a signed-in member before touching the database', async () => {
    requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect(await submitProductFeedbackAction({ body: GOOD })).toEqual({ ok: false, error: 'Unauthorized' })
    expect(q.createProductFeedback).not.toHaveBeenCalled()
  })

  it('enforces the same body rules as the widget: length and no links', async () => {
    expect(await submitProductFeedbackAction({ body: 'too short' })).toMatchObject({ ok: false })
    expect(await submitProductFeedbackAction({ body: `${GOOD} https://spam.example` })).toMatchObject({
      ok: false,
    })
    expect(q.createProductFeedback).not.toHaveBeenCalled()
  })

  it('rate-limits per user', async () => {
    rateLimitShared.mockResolvedValue({ ok: false })
    const res = await submitProductFeedbackAction({ body: GOOD })
    expect(res).toMatchObject({ ok: false })
    expect(rateLimitShared.mock.calls[0]).toEqual(['product-feedback:9', 5, 60 * 60 * 1000])
    expect(q.createProductFeedback).not.toHaveBeenCalled()
  })
})

describe('when the widget is not enabled', () => {
  it('submit is refused before any auth or database work', async () => {
    delete process.env.FEEDBACK_WIDGET_ENABLED
    expect(await submitProductFeedbackAction({ body: GOOD })).toEqual({ ok: false, error: 'Feedback is not available.' })
    expect(requireOrgAccess).not.toHaveBeenCalled()
    expect(q.createProductFeedback).not.toHaveBeenCalled()
  })
})

describe('exports', () => {
  it('exposes no moderation, reply, or update actions — those are written by operator tooling outside this app', () => {
    expect(Object.keys(actions)).toEqual(['submitProductFeedbackAction'])
  })
})
