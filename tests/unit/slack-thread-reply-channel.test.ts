import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Real bug confirmed live: AI replies for any Slack ticket associated with
// a thread failed with chat.postMessage's channel_not_found. Root cause:
// the codebase conflates "channel to post the reply into" with "thread id"
// into a single field (`threadId ?? channelId`) — correct for Discord,
// where a thread has its own postable id that stands in for the channel,
// but wrong for Slack, which always needs the real channel id in `channel`
// plus thread_ts as a separate field. Once a Slack message becomes a
// thread parent (gets a reply), Slack's API starts returning thread_ts on
// that message too, so the conflated field silently became a message
// timestamp instead of a channel id, and Slack rejected it outright.
//
// Fixed by threading the real channelId and threadId through as two new,
// Slack-only trailing parameters — the existing `threadId ?? channelId`
// parameter is left untouched everywhere, since Discord/Telegram/Email
// still need exactly that value. sendToSlackChannel's own thread_ts
// behavior is covered separately in slack-send-thread-ts.test.ts.

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const {
  sendToSlackChannel,
  getIntegration,
  generateText,
  assessAnswer,
} = vi.hoisted(() => ({
  sendToSlackChannel: vi.fn(async (_channel: string, _content: string, _orgId: number, _threadTs?: string) => 'posted-ts'),
  // Automatic Deflections must be explicitly on — this test exercises the
  // auto-deflect (high-confidence) branch's channel-routing, not the toggle
  // itself (see tests/unit/auto-deflect-toggle.test.ts for that).
  getIntegration: vi.fn(async () => ({ auto_deflect_enabled: 1, confidence_threshold: null })),
  generateText: vi.fn(async () => ({ text: 'an answer' })),
  assessAnswer: vi.fn(async () => ({ confidence: 0.9, answered_fully: true, reasoning: 'x' })),
}))

vi.mock('@/lib/slack/send', () => ({ sendToSlackChannel }))
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
  // This test exercises the auto-deflect (high-confidence) branch
  // specifically, since the low-confidence branch deliberately no longer
  // posts publicly at all (see slack-approve-gate.test.ts) — nothing to
  // assert on the real-channel fix there.
  shouldAutoDeflect: (a: { confidence: number; answered_fully: boolean }, threshold = 0.8) => a.confidence >= threshold && a.answered_fully,
  AUTO_DEFLECT_THRESHOLD: 0.8,
  ASSESS_MODEL: 'test-model',
}))
vi.mock('@/lib/billing/usage', () => ({ reserveAutoDeflect: vi.fn(async () => true) }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => false) }))
vi.mock('@/lib/github/tools', () => ({ searchCode: vi.fn(), readFile: vi.fn(), listFiles: vi.fn() }))
vi.mock('@/lib/github/app', () => ({ getConfiguredRepos: vi.fn(async () => []) }))
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

describe('lib/ai/agent.ts — Slack posts use the real channel id, never the conflated thread-or-channel field', () => {
  it('postReply passes slackChannelId (falling back to channelId) and slackThreadTs to sendToSlackChannel for the slack branch', () => {
    // postReply moved to lib/channels/post-reply.ts (shared with
    // lib/actions/tickets.ts) as part of the Automatic Deflections toggle —
    // its per-platform logic, including this Slack branch, is unchanged.
    const src = read('lib/channels/post-reply.ts')
    const fnIdx = src.indexOf('export async function postReply')
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnBody).toContain('sendToSlackChannel(slackChannelId ?? channelId, content, orgId, slackThreadTs)')
  })

  it('runAIAgent accepts slackChannelId/slackThreadTs and forwards them to every dispatch/postNeedsHumanReview call', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).toContain('slackChannelId?: string,\n  slackThreadTs?: string\n): Promise<void> {')

    // Every runAIAgent-internal `await dispatch(...)` call (there are 5 —
    // dispatch is agent.ts's local wrapper around the shared postReply,
    // added to also branch GitHub tickets to postReplyToGithub) must
    // forward both new params. Calls are single-line statements, so match
    // to the line's own closing paren.
    const dispatchCalls = src.match(/await dispatch\([^)]*\)/g) ?? []
    const callsWithBothParams = dispatchCalls.filter((c) => c.includes('slackChannelId') && c.includes('slackThreadTs'))
    expect(dispatchCalls.length).toBeGreaterThanOrEqual(4)
    expect(callsWithBothParams.length).toBe(dispatchCalls.length)

    const postNeedsHumanReviewCalls = src.match(/postNeedsHumanReview\(\s*ticketId,[^;]*?\n(?:\s*)\)/g) ?? []
    expect(postNeedsHumanReviewCalls.length).toBe(2)
    for (const call of postNeedsHumanReviewCalls) {
      expect(call).toContain('slackChannelId')
      expect(call).toContain('slackThreadTs')
    }
  })
})

describe('lib/ingest/pipeline.ts — passes the real channelId and threadId separately to runAIAgent', () => {
  it('appends channelId and threadId as new trailing args, leaving the existing threadId ?? channelId arg untouched', () => {
    const src = read('lib/ingest/pipeline.ts')
    expect(src).toContain(
      "runAIAgent(ticketId, content, threadId ?? channelId, priorAnswers, orgId, platform, category ?? 'general_question', duplicates, orgTicketNumber, aiPurpose, channelId, threadId)"
    )
  })
})

describe('runAIAgent: Slack posts using the real channel, not the conflated thread-or-channel value', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateText.mockResolvedValue({ text: 'an answer' })
    assessAnswer.mockResolvedValue({ confidence: 0.9, answered_fully: true, reasoning: 'x' })
  })

  it('posts using the real Slack channel id, not the conflated thread-or-channel positional arg', async () => {
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(
      1,
      'a question in a thread',
      'ts-2', // the conflated legacy positional arg — a thread ts, not a channel
      [],
      3,
      'slack',
      'general_question',
      [],
      1,
      'production',
      'C_REAL_CHANNEL', // slackChannelId — the real channel
      'ts-2' // slackThreadTs
    )

    expect(sendToSlackChannel).toHaveBeenCalled()
    const [channelArg, , , threadTsArg] = sendToSlackChannel.mock.calls[0]
    expect(channelArg).toBe('C_REAL_CHANNEL')
    expect(channelArg).not.toBe('ts-2')
    expect(threadTsArg).toBe('ts-2')
  })
})
