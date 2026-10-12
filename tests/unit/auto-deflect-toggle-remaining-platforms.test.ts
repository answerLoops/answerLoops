import { describe, it, expect, vi, beforeEach } from 'vitest'

// tests/unit/auto-deflect-toggle.test.ts already covers Slack and GitHub —
// this file extends the exact same deterministic AI-mock pattern (a fake
// Agent.generate standing in for the real LLM call, so the "AI answer" is a
// known fixed string with no network/tokens involved) to the remaining four
// platforms: Discord, Telegram, Email, Google Chat. Each gets both states —
// toggle off must send nothing to the channel at all, toggle on must send
// the real answer — proving the Settings-page
// visibility work in this branch (badges, toggle switches, confirm modal)
// sits on top of gating logic that actually still works per platform, not
// just that the UI displays a state correctly.

const {
  sendToChannel,
  sendToTelegramChat,
  sendEmailReply,
  sendToGoogleChatSpace,
  getIntegration,
  reserveAutoDeflect,
  updateTicketAIDraftStatus,
  generateText,
  assessAnswer,
} = vi.hoisted(() => ({
  sendToChannel: vi.fn(async (_channelId: string, _content: string, _orgId: number) => 'posted-id'),
  sendToTelegramChat: vi.fn(async (_chatId: string, _content: string, _orgId: number) => 'posted-id'),
  sendEmailReply: vi.fn(async (_to: string, _content: string, _orgId: number) => 'posted-id'),
  sendToGoogleChatSpace: vi.fn(async (_spaceId: string, _content: string, _orgId: number) => 'posted-id'),
  getIntegration: vi.fn(async () => null as { auto_deflect_enabled: number; confidence_threshold: number | null } | null),
  reserveAutoDeflect: vi.fn(async (_orgId: number, cb: (tx: unknown, allowed: boolean) => Promise<void>) => {
    await cb({}, true)
    return true
  }),
  updateTicketAIDraftStatus: vi.fn(),
  generateText: vi.fn(async () => ({ text: 'a high-confidence draft answer' })),
  assessAnswer: vi.fn(async () => ({ confidence: 0.95, answered_fully: true, reasoning: 'x' })),
}))

vi.mock('@/lib/kb/review-capture', () => ({ captureUnansweredQuestion: vi.fn(async () => {}) }))
vi.mock('@/lib/discord/send', () => ({ sendToChannel }))
vi.mock('@/lib/slack/send', () => ({ sendToSlackChannel: vi.fn() }))
vi.mock('@/lib/telegram/send', () => ({ sendToTelegramChat }))
vi.mock('@/lib/email/reply', () => ({ sendEmailReply }))
vi.mock('@/lib/google-chat/send', () => ({ sendToGoogleChatSpace }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegration }))
vi.mock('@/lib/db/queries/github', () => ({ getRepoByOwnerAndName: vi.fn(async () => null) }))
vi.mock('@/lib/github/app', () => ({
  getConfiguredRepos: vi.fn(async () => []),
  getInstallationOctokitById: vi.fn(),
}))
vi.mock('@/lib/db/queries/tickets', () => ({
  updateTicketAIDraft: vi.fn(),
  updateTicketAIDraftStatus,
  getTicketById: vi.fn(async () => ({ id: 1, source_channel_id: 'C123', source_message_id: 'msg-1' })),
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

interface Case {
  platform: 'discord' | 'telegram' | 'email' | 'google_chat'
  send: typeof sendToChannel
}

const cases: Case[] = [
  { platform: 'discord', send: sendToChannel },
  { platform: 'telegram', send: sendToTelegramChat },
  { platform: 'email', send: sendEmailReply },
  { platform: 'google_chat', send: sendToGoogleChatSpace },
]

describe.each(cases)('runAIAgent: Automatic Deflections toggle — $platform', ({ platform, send }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateText.mockResolvedValue({ text: 'a high-confidence draft answer' })
    assessAnswer.mockResolvedValue({ confidence: 0.95, answered_fully: true, reasoning: 'x' })
    getIntegration.mockResolvedValue(null)
  })

  it('toggle off: holds the real AI answer back, quota not consumed', async () => {
    getIntegration.mockResolvedValue({ auto_deflect_enabled: 0, confidence_threshold: null })
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'C123', [], 3, platform, 'general_question', [], 1)

    if (platform === 'google_chat') {
      // Google Chat's client flags the app as "not responding" for total
      // silence — it gets a content-free keep-alive receipt instead, see
      // sendKeepAlive in lib/channels/post-reply.ts. Every other platform
      // sends nothing at all.
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][1]).toBe('👍')
    } else {
      expect(send).not.toHaveBeenCalled()
    }
    expect(updateTicketAIDraftStatus).toHaveBeenCalledWith(1, 'needs_human')
    expect(reserveAutoDeflect).not.toHaveBeenCalled()
  })

  it('toggle on: the real AI-generated answer actually sends, quota consumed', async () => {
    getIntegration.mockResolvedValue({ auto_deflect_enabled: 1, confidence_threshold: null })
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'C123', [], 3, platform, 'general_question', [], 1)

    expect(send).toHaveBeenCalled()
    expect(send.mock.calls[0][1]).toContain('a high-confidence draft answer')
    expect(reserveAutoDeflect).toHaveBeenCalled()
  })
})
