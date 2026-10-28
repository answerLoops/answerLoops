import { describe, it, expect, vi, beforeEach } from 'vitest'

// Every reply answerLoops posts to a ticket's channel is also kept in the
// ticket's conversation, as the text the customer read. These drive the part of
// runAIAgent that never calls a model (bug reports and feature requests) end to
// end, so what is recorded, and when, is checked as behaviour.

const h = vi.hoisted(() => ({
  postReply: vi.fn(async (..._args: unknown[]): Promise<string | null> => 'posted-1'),
  sendKeepAlive: vi.fn(async () => undefined),
  mapAnswerMessage: vi.fn(async () => undefined),
  recordAnswerLoopsReply: vi.fn(async (..._args: unknown[]) => true),
  updateTicketAIDraft: vi.fn(async () => undefined),
  updateTicketAIDraftStatus: vi.fn(async () => undefined),
  getTicketById: vi.fn(async (id: number): Promise<Record<string, unknown> | null> => (id === 9 ? { org_ticket_number: 3 } : { ai_draft_status: 'pending' })),
  getIntegration: vi.fn(async (): Promise<Record<string, unknown> | null> => ({ escalation_role_id: 'R1', auto_deflect_enabled: 1 })),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@mastra/core/agent', () => ({ Agent: class {} }))
vi.mock('@mastra/core/tools', () => ({ createTool: vi.fn() }))
vi.mock('@/lib/ai/models', () => ({ chatModel: vi.fn(), DEFAULT_CHAT_MODEL: 'm', NoAIProviderConfiguredError: class extends Error {} }))
vi.mock('@/lib/github/tools', () => ({ searchCode: vi.fn(), readFile: vi.fn(), listFiles: vi.fn() }))
vi.mock('@/lib/github/app', () => ({ getConfiguredRepos: vi.fn(async () => []) }))
vi.mock('@/lib/db/queries/tickets', () => ({
  updateTicketAIDraft: h.updateTicketAIDraft,
  updateTicketAIDraftStatus: h.updateTicketAIDraftStatus,
  getTicketById: h.getTicketById,
  recordAnswerLoopsReply: h.recordAnswerLoopsReply,
}))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification: vi.fn(async () => undefined) }))
vi.mock('@/lib/db/queries/assessments', () => ({ saveAssessment: vi.fn() }))
vi.mock('@/lib/db/queries/feedback', () => ({ mapAnswerMessage: h.mapAnswerMessage }))
vi.mock('@/lib/db/queries/csat', () => ({ mapCsatMessage: vi.fn() }))
vi.mock('@/lib/ai/assess', () => ({ assessAnswer: vi.fn(), shouldAutoDeflect: vi.fn(), AUTO_DEFLECT_THRESHOLD: 85, ASSESS_MODEL: 'm' }))
vi.mock('@/lib/channels/post-reply', () => ({ postReply: h.postReply, postReplyToGithub: vi.fn(), sendKeepAlive: h.sendKeepAlive }))
vi.mock('@/lib/billing/usage', () => ({ reserveAutoDeflect: vi.fn() }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => true) }))
vi.mock('@/lib/kb/review-capture', () => ({ captureUnansweredQuestion: vi.fn() }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegration: h.getIntegration }))
vi.mock('@/lib/logger', () => ({ logger: h.logger }))
vi.mock('@/lib/kb/usage', () => ({ countArticleUsage: vi.fn(), newAnswerId: () => '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44', recordAnswerSources: vi.fn() }))

import { runAIAgent } from '@/lib/ai/agent'

const FEATURE_ACK =
  "Thanks for the suggestion — we don't have this in progress yet. A team member will review it and follow up here.\n\n*A team member will follow up shortly.*"

function run(over: { category?: 'bug' | 'feature_request'; duplicates?: never[] | { related_id: number; score: number }[]; prior?: { summary: string; answer: string }[] } = {}) {
  return runAIAgent(
    5,
    'Please add a changelog link',
    'C1',
    (over.prior ?? []) as never,
    1,
    'discord',
    over.category ?? 'feature_request',
    (over.duplicates ?? []) as never,
    7
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.postReply.mockResolvedValue('posted-1')
  h.recordAnswerLoopsReply.mockResolvedValue(true)
  h.getIntegration.mockResolvedValue({ escalation_role_id: 'R1', auto_deflect_enabled: 1 })
})

describe('runAIAgent keeps what it posted in the ticket conversation', () => {
  it('records the acknowledgment as the customer read it, without the escalation mention, under the posted id', async () => {
    await run()
    expect(h.postReply).toHaveBeenCalledTimes(1)
    expect(String(h.postReply.mock.calls[0][1])).toContain('<@&R1>')
    expect(h.recordAnswerLoopsReply).toHaveBeenCalledExactlyOnceWith(5, FEATURE_ACK, { messageId: 'posted-1' })
    expect(h.mapAnswerMessage).toHaveBeenCalledWith('posted-1', 5)
  })

  it('records the bug-report acknowledgment, not the feature one', async () => {
    await run({ category: 'bug' })
    expect(h.recordAnswerLoopsReply.mock.calls[0][1]).toMatch(/^Thanks for the report — we don't have this tracked yet\./)
  })

  it('records the duplicate notice with the related ticket\'s own number', async () => {
    await run({ duplicates: [{ related_id: 9, score: 0.9 }] })
    expect(h.recordAnswerLoopsReply).toHaveBeenCalledExactlyOnceWith(
      5,
      "Thanks for the report — this looks like something we're already tracking as ticket #3. We'll keep that ticket updated as it progresses.",
      { messageId: 'posted-1' }
    )
  })

  it('records the knowledge-base workaround without the reaction footer', async () => {
    await run({ prior: [{ summary: 'Reset', answer: 'Use the reset link.' }] })
    const text = String(h.recordAnswerLoopsReply.mock.calls[0][1])
    expect(text).toContain('as a workaround: Use the reset link.')
    expect(text).not.toContain('React 👍')
    expect(String(h.postReply.mock.calls[0][1])).toContain('React 👍')
  })

  it('records nothing when Automatic Deflections is off, since nothing was posted', async () => {
    h.getIntegration.mockResolvedValue({ escalation_role_id: 'R1', auto_deflect_enabled: 0 })
    await run()
    expect(h.postReply).not.toHaveBeenCalled()
    expect(h.recordAnswerLoopsReply).not.toHaveBeenCalled()
  })

  it('records nothing when the channel gave no id for the post', async () => {
    h.postReply.mockResolvedValue(null)
    await run()
    expect(h.postReply).toHaveBeenCalledTimes(1)
    expect(h.recordAnswerLoopsReply).not.toHaveBeenCalled()
  })

  it('does not fail, or re-post, when keeping the reply fails: it has already gone out', async () => {
    h.recordAnswerLoopsReply.mockRejectedValue(new Error('db down'))
    await expect(run()).resolves.toBeUndefined()
    expect(h.postReply).toHaveBeenCalledTimes(1)
    expect(h.logger.warn).toHaveBeenCalledWith(
      'could not keep the posted reply in the ticket conversation',
      expect.objectContaining({ ticketId: 5 })
    )
    expect(h.logger.error).not.toHaveBeenCalled()
  })
})
