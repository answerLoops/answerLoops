import { describe, it, expect, vi, beforeEach } from 'vitest'

// lib/ai/agent.ts's postReply needs to route a Google Chat reply to the
// right space + (if applicable) thread, but unlike Slack it gets no
// separate slackChannelId/slackThreadTs-style parameters — the space name
// is recovered from the thread resourceName's own prefix
// (`spaces/X/threads/Y` → space `spaces/X`) instead. These tests cover both
// the top-level (no thread yet) and threaded cases.

const { sendToGoogleChatSpace, getIntegration, assessAnswer } = vi.hoisted(() => ({
  sendToGoogleChatSpace: vi.fn(async (_space: string, _content: string, _thread?: string) => 'posted-name'),
  // Automatic Deflections must be explicitly on for these tests — they're
  // testing space/thread routing on the auto-deflect path, not the toggle
  // itself (see tests/unit/auto-deflect-toggle.test.ts for that).
  getIntegration: vi.fn(async () => ({ auto_deflect_enabled: 1, confidence_threshold: null })),
  assessAnswer: vi.fn(async () => ({ confidence: 0.9, answered_fully: true, reasoning: 'x' })),
}))

vi.mock('@/lib/kb/review-capture', () => ({ captureUnansweredQuestion: vi.fn(async () => {}) }))
vi.mock('@/lib/google-chat/send', () => ({ sendToGoogleChatSpace }))
vi.mock('@/lib/slack/send', () => ({ sendToSlackChannel: vi.fn() }))
vi.mock('@/lib/discord/send', () => ({ sendToChannel: vi.fn() }))
vi.mock('@/lib/telegram/send', () => ({ sendToTelegramChat: vi.fn() }))
vi.mock('@/lib/email/reply', () => ({ sendEmailReply: vi.fn() }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegration }))
vi.mock('@/lib/db/queries/tickets', () => ({
  updateTicketAIDraft: vi.fn(),
  updateTicketAIDraftStatus: vi.fn(),
  getTicketById: vi.fn(),
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
vi.mock('@/lib/billing/usage', () => ({ reserveAutoDeflect: vi.fn(async () => true) }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => false) }))
vi.mock('@/lib/github/tools', () => ({ searchCode: vi.fn(), readFile: vi.fn(), listFiles: vi.fn() }))
vi.mock('@/lib/github/app', () => ({ getConfiguredRepos: vi.fn(async () => []) }))
// agent.ts runs a real @mastra/core Agent (not the bare 'ai' package), so
// chatModel() must resolve to an actual LanguageModel instance the Agent can
// call doGenerate on — a bare string is no longer accepted by Agent's model
// resolver. Reuse the same deterministic fake production's own mock mode
// uses (lib/ai/mock.ts) instead of hand-rolling a second one.
vi.mock('@/lib/ai/models', async () => {
  const { mockLanguageModel } = await import('@/lib/ai/mock')
  return {
    chatModel: vi.fn(async (defaultId: string) => mockLanguageModel(defaultId)),
    DEFAULT_CHAT_MODEL: 'gpt-4o',
    NoAIProviderConfiguredError: class extends Error {},
  }
})

describe('runAIAgent: Google Chat replies route to the right space/thread', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assessAnswer.mockResolvedValue({ confidence: 0.9, answered_fully: true, reasoning: 'x' })
  })

  it('a brand-new (non-thread) message posts to the space with no thread name', async () => {
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'spaces/AAAA111', [], 3, 'google_chat', 'general_question', [], 1)

    expect(sendToGoogleChatSpace).toHaveBeenCalled()
    const [spaceArg, , threadArg] = sendToGoogleChatSpace.mock.calls[0]
    expect(spaceArg).toBe('spaces/AAAA111')
    expect(threadArg).toBeUndefined()
  })

  it('a threaded reply derives the space from the thread resourceName prefix and passes the thread name through', async () => {
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question in a thread', 'spaces/AAAA111/threads/BBBB222', [], 3, 'google_chat', 'general_question', [], 1)

    expect(sendToGoogleChatSpace).toHaveBeenCalled()
    const [spaceArg, , threadArg] = sendToGoogleChatSpace.mock.calls[0]
    expect(spaceArg).toBe('spaces/AAAA111')
    expect(threadArg).toBe('spaces/AAAA111/threads/BBBB222')
  })
})
