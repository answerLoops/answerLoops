import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Automatic Deflections toggle (default OFF, per platform/repo) gates
// whether a high-confidence answer actually auto-posts. lib/ai/agent.ts's
// runAIAgent combines shouldAutoDeflect(assessment, threshold) with the
// integration's auto_deflect_enabled flag — both must be true for
// wantsAutoDeflect to be true. These tests cover: the toggle blocking a
// high-confidence answer, the toggle preserving today's behavior when on,
// the org's configured confidence_threshold actually being read instead of
// the hardcoded 80% constant, and GitHub's auto-deflect dispatch (which was
// silently broken before this PR — it fell through to Discord's send
// function and 404d invisibly).

const {
  sendToSlackChannel,
  sendToChannel,
  createComment,
  getRepoByOwnerAndName,
  updateTicketAIDraftStatus,
  reserveAutoDeflect,
  getIntegration,
  generateText,
  assessAnswer,
  captureUnansweredQuestion,
} = vi.hoisted(() => ({
  sendToSlackChannel: vi.fn(async (_channel: string, _content: string, _orgId: number, _threadTs?: string) => 'posted-ts'),
  sendToChannel: vi.fn(async (_channelId: string, _content: string, _orgId: number) => 'posted-id'),
  createComment: vi.fn(async (_params: { owner: string; repo: string; issue_number: number; body: string }) => ({ data: { id: 999 } })),
  getRepoByOwnerAndName: vi.fn(async () => ({ id: 1, org_id: 3, installation_id: 42, auto_deflect_enabled: 0 })),
  updateTicketAIDraftStatus: vi.fn(),
  reserveAutoDeflect: vi.fn(async (_orgId: number, cb: (tx: unknown, allowed: boolean) => Promise<void>) => {
    await cb({}, true)
    return true
  }),
  getIntegration: vi.fn(async () => null as { auto_deflect_enabled: number; confidence_threshold: number | null } | null),
  generateText: vi.fn(async () => ({ text: 'a high-confidence draft answer' })),
  assessAnswer: vi.fn(async () => ({ confidence: 0.95, answered_fully: true, reasoning: 'x' })),
  captureUnansweredQuestion: vi.fn(async () => {}),
}))

vi.mock('@/lib/kb/review-capture', () => ({ captureUnansweredQuestion }))
vi.mock('@/lib/slack/send', () => ({ sendToSlackChannel }))
vi.mock('@/lib/discord/send', () => ({ sendToChannel }))
vi.mock('@/lib/telegram/send', () => ({ sendToTelegramChat: vi.fn() }))
vi.mock('@/lib/email/reply', () => ({ sendEmailReply: vi.fn() }))
vi.mock('@/lib/google-chat/send', () => ({ sendToGoogleChatSpace: vi.fn() }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegration }))
vi.mock('@/lib/db/queries/github', () => ({ getRepoByOwnerAndName }))
vi.mock('@/lib/github/app', () => ({
  getConfiguredRepos: vi.fn(async () => []),
  getInstallationOctokitById: vi.fn(async () => ({ rest: { issues: { createComment } } })),
}))
vi.mock('@/lib/db/queries/tickets', () => ({
  updateTicketAIDraft: vi.fn(),
  updateTicketAIDraftStatus,
  getTicketById: vi.fn(async () => ({ id: 1, source_channel_id: 'owner/repo', source_message_id: 'github-issue-42' })),
}))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/db/queries/assessments', () => ({ saveAssessment: vi.fn(async () => {}) }))
vi.mock('@/lib/db/queries/feedback', () => ({ mapAnswerMessage: vi.fn(), mapCsatMessage: vi.fn() }))
vi.mock('@/lib/db/queries/csat', () => ({ mapCsatMessage: vi.fn() }))
vi.mock('@/lib/ai/assess', () => ({
  assessAnswer,
  shouldAutoDeflect: (a: { confidence: number; answered_fully: boolean }, threshold = 0.8) => a.confidence >= threshold && a.answered_fully,
  AUTO_DEFLECT_THRESHOLD: 0.8,
  ASSESS_MODEL: 'test-model',
}))
vi.mock('@/lib/billing/usage', () => ({ reserveAutoDeflect }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => false) }))
vi.mock('@/lib/github/tools', () => ({ searchCode: vi.fn(), readFile: vi.fn(), listFiles: vi.fn() }))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(_config: unknown) {}
    async generate(..._args: unknown[]) {
      return generateText()
    }
  },
}))
vi.mock('@/lib/ai/models', () => ({
  chatModel: vi.fn(async () => 'mock-model'),
  DEFAULT_CHAT_MODEL: 'gpt-4o',
  NoAIProviderConfiguredError: class extends Error {},
}))

describe('runAIAgent: Automatic Deflections toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateText.mockResolvedValue({ text: 'a high-confidence draft answer' })
    assessAnswer.mockResolvedValue({ confidence: 0.95, answered_fully: true, reasoning: 'x' })
    getIntegration.mockResolvedValue(null)
    getRepoByOwnerAndName.mockResolvedValue({ id: 1, org_id: 3, installation_id: 42, auto_deflect_enabled: 0 })
  })

  it('toggle off blocks a 95% confidence answer from auto-posting — nothing sent to Slack, quota not consumed', async () => {
    getIntegration.mockResolvedValue({ auto_deflect_enabled: 0, confidence_threshold: null })
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'C123', [], 3, 'slack', 'general_question', [], 1)

    expect(sendToSlackChannel).not.toHaveBeenCalled()
    expect(updateTicketAIDraftStatus).toHaveBeenCalledWith(1, 'needs_human', undefined, undefined)
    expect(reserveAutoDeflect).not.toHaveBeenCalled()
  })

  it('toggle on preserves auto-post behavior — real answer posts, quota consumed, CSAT follow-up sent', async () => {
    getIntegration.mockResolvedValue({ auto_deflect_enabled: 1, confidence_threshold: null })
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'C123', [], 3, 'slack', 'general_question', [], 1)

    expect(sendToSlackChannel).toHaveBeenCalled()
    const calls = sendToSlackChannel.mock.calls
    expect(calls[0][1]).toContain('a high-confidence draft answer')
    expect(reserveAutoDeflect).toHaveBeenCalled()
    // Real answer + CSAT prompt = 2 sends
    expect(calls.length).toBe(2)
  })

  it('reads the org-configured confidence_threshold instead of the hardcoded 80% constant', async () => {
    // 65% confidence would NOT clear the old hardcoded 0.8 bar, but does
    // clear this org's configured 0.6 — proves the value is actually
    // plumbed through, not just unit-testable on shouldAutoDeflect alone.
    getIntegration.mockResolvedValue({ auto_deflect_enabled: 1, confidence_threshold: 0.6 })
    assessAnswer.mockResolvedValue({ confidence: 0.65, answered_fully: true, reasoning: 'x' })
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'C123', [], 3, 'slack', 'general_question', [], 1)

    expect(reserveAutoDeflect).toHaveBeenCalled()
    expect(sendToSlackChannel.mock.calls[0][1]).toContain('a high-confidence draft answer')
  })

  it('GitHub auto-deflect posts via Octokit when the repo has Automatic Deflections on — this path silently 404d before this fix', async () => {
    getRepoByOwnerAndName.mockResolvedValue({ id: 1, org_id: 3, installation_id: 42, auto_deflect_enabled: 1 })
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'owner/repo', [], 3, 'github', 'general_question', [], 1)

    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'repo', issue_number: 42, body: expect.stringContaining('a high-confidence draft answer') })
    )
    // The bug this regresses: platform 'github' has no channelId-shaped
    // destination and must never fall through to Discord's send function.
    expect(sendToChannel).not.toHaveBeenCalled()
  })

  it('GitHub with Automatic Deflections off posts no comment at all — same toggle-off behavior as every other platform', async () => {
    getRepoByOwnerAndName.mockResolvedValue({ id: 1, org_id: 3, installation_id: 42, auto_deflect_enabled: 0 })
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'owner/repo', [], 3, 'github', 'general_question', [], 1)

    expect(createComment).not.toHaveBeenCalled()
    expect(sendToChannel).not.toHaveBeenCalled()
  })

  describe('unseen-question capture for the review queue', () => {
    it('queues a question nothing covered, carrying the draft only when the grader called it a full answer', async () => {
      getIntegration.mockResolvedValue({ auto_deflect_enabled: 1, confidence_threshold: null })
      const { runAIAgent } = await import('@/lib/ai/agent')

      await runAIAgent(7, 'a question', 'C123', [], 3, 'slack', 'general_question', [], 1)

      expect(captureUnansweredQuestion).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          orgId: 3,
          source: 'ticket',
          question: 'a question',
          ticketId: 7,
          confidence: 0.95,
          answer: 'a high-confidence draft answer',
        })
      )
    })

    it('queues it with no answer when the grader judged the draft incomplete', async () => {
      assessAnswer.mockResolvedValue({ confidence: 0.3, answered_fully: false, reasoning: 'x' })
      const { runAIAgent } = await import('@/lib/ai/agent')

      await runAIAgent(7, 'a question', 'C123', [], 3, 'slack', 'general_question', [], 1)

      expect(captureUnansweredQuestion).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ answer: '' }))
    })

    it('does not queue a question the knowledge base or prior answers covered', async () => {
      const { runAIAgent } = await import('@/lib/ai/agent')

      await runAIAgent(7, 'a question', 'C123', [{ summary: 's', answer: 'a' }], 3, 'slack', 'general_question', [], 1)

      expect(captureUnansweredQuestion).not.toHaveBeenCalled()
    })

    it('does not queue bug reports or feature requests, which are never KB-deflectable', async () => {
      const { runAIAgent } = await import('@/lib/ai/agent')

      await runAIAgent(7, 'it crashes', 'C123', [], 3, 'slack', 'bug', [], 1)

      expect(captureUnansweredQuestion).not.toHaveBeenCalled()
    })
  })
})
