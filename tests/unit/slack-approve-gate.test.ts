import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Integration } from '@/lib/db/queries/integrations'
import fs from 'node:fs'
import path from 'node:path'

// Real bug confirmed live: a low-confidence AI-drafted answer was posted
// publicly to Slack immediately, unreviewed, labeled "Needs Human Review" —
// while the dashboard simultaneously showed Approve/Edit/Dismiss buttons as
// if the draft were still awaiting a decision. This contradicted the
// documented confidence gate ("only high-confidence answers post
// automatically; everything else routes to a human with a draft") and
// meant every non-auto-deflected answer, on every platform, went out to
// customers unreviewed.
//
// Fixed by never posting the KB-graded low-confidence draft *content*
// publicly: the ticket is marked needs_human and the draft stays saved
// (unchanged — updateTicketAIDraft already ran before this point) for a
// staff member to approve from the dashboard. A generic, non-AI-authored
// acknowledgment ("a team member will follow up shortly") is sent in its
// place instead of the real draft — but only when Automatic Deflections is
// on for the platform. If it's off, the org has explicitly opted out of
// unsupervised posting and NOTHING goes out, not even this generic ack
// (surfaced 2026-08-10: a customer testing Google Chat with deflections off
// still got an unexpected auto-reply — see
// tests/unit/auto-deflect-toggle.test.ts for the off-means-silent coverage).
// The bug/feature_request acknowledgment path follows the same toggle gate
// now too — its message is always a generic template, never AI-authored
// answer content, but it still only posts when deflections are on.
//
// Note: "Approve" now sends the draft on every platform (fixed in the same
// pass as the Automatic Deflections toggle — see
// lib/actions/tickets.ts's sendReply and lib/channels/post-reply.ts) — it
// used to only send for GitHub. See tests/unit/auto-deflect-toggle.test.ts
// for coverage of that fix and the toggle itself.

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const {
  sendToSlackChannel,
  updateTicketAIDraftStatus,
  getIntegration,
  generateText,
  assessAnswer,
} = vi.hoisted(() => ({
  sendToSlackChannel: vi.fn(async (_channel: string, _content: string, _orgId: number, _threadTs?: string) => 'posted-ts'),
  updateTicketAIDraftStatus: vi.fn(),
  getIntegration: vi.fn(async (): Promise<Partial<Integration> | null> => null),
  generateText: vi.fn(async () => ({ text: 'a low-confidence draft answer' })),
  assessAnswer: vi.fn(async () => ({ confidence: 0.3, answered_fully: false, reasoning: 'x' })),
}))

vi.mock('@/lib/slack/send', () => ({ sendToSlackChannel }))
vi.mock('@/lib/discord/send', () => ({ sendToChannel: vi.fn() }))
vi.mock('@/lib/telegram/send', () => ({ sendToTelegramChat: vi.fn() }))
vi.mock('@/lib/email/reply', () => ({ sendEmailReply: vi.fn() }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegration }))
vi.mock('@/lib/db/queries/tickets', () => ({
  updateTicketAIDraft: vi.fn(),
  updateTicketAIDraftStatus,
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

describe('lib/ai/agent.ts — postNeedsHumanReview never posts the unreviewed AI draft content publicly', () => {
  it('the KB-graded low-confidence call site passes postDraftPublicly: false', () => {
    const src = read('lib/ai/agent.ts')
    const idx = src.indexOf("'this question needs human review'")
    expect(idx).toBeGreaterThan(-1)
    const callSite = src.slice(src.lastIndexOf('await postNeedsHumanReview(', idx), src.indexOf(')', idx + 200))
    expect(callSite).toContain('false, // never post the unreviewed AI draft publicly')
  })

  it('the bug/feature_request acknowledgment call site is unaffected — no postDraftPublicly arg, defaults to true', () => {
    const src = read('lib/ai/agent.ts')
    const idx = src.indexOf("`this ${category === 'bug' ? 'report' : 'request'} needs human review`")
    expect(idx).toBeGreaterThan(-1)
    const callSite = src.slice(src.lastIndexOf('await postNeedsHumanReview(', idx), src.indexOf(')', idx))
    expect(callSite).not.toContain('false')
  })

  it('sends the generic acknowledgment instead of the real bodyText when postDraftPublicly is false', () => {
    const src = read('lib/ai/agent.ts')
    const fnIdx = src.indexOf('async function postNeedsHumanReview')
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    const statusIdx = fnBody.indexOf("updateTicketAIDraftStatus(ticketId, 'needs_human')")
    // Search from statusIdx onward — postDraftPublicly also appears earlier
    // in the parameter list, which isn't the branch we care about here.
    const ternaryIdx = fnBody.indexOf('postDraftPublicly', statusIdx)
    const bodyTextInBranchIdx = fnBody.indexOf('${bodyText}')
    const postIdx = fnBody.indexOf('await dispatch(')
    expect(statusIdx).toBeGreaterThan(-1)
    // updateTicketAIDraftStatus always runs first, regardless of which
    // branch the message ternary takes.
    expect(ternaryIdx).toBeGreaterThan(statusIdx)
    // bodyText (the real AI draft) is only interpolated in the
    // postDraftPublicly:true branch — a post-then-check on the actual sent
    // message content is covered by the runAIAgent tests below.
    expect(bodyTextInBranchIdx).toBeGreaterThan(ternaryIdx)
    expect(postIdx).toBeGreaterThan(ternaryIdx)
  })
})

describe('runAIAgent: low-confidence answers are held for approval, generic ack sent instead of the draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateText.mockResolvedValue({ text: 'a low-confidence draft answer' })
    assessAnswer.mockResolvedValue({ confidence: 0.3, answered_fully: false, reasoning: 'x' })
    // Automatic Deflections on — the generic ack only goes out when the org
    // has opted into unsupervised posting; the toggle-off case (no ack at
    // all) is covered by tests/unit/auto-deflect-toggle.test.ts.
    getIntegration.mockResolvedValue({ auto_deflect_enabled: 1, confidence_threshold: null })
  })

  it('sends a generic acknowledgment to Slack, never the actual draft text', async () => {
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'C123', [], 3, 'slack', 'general_question', [], 1, 'production', 'C123', undefined)

    expect(sendToSlackChannel).toHaveBeenCalled()
    const [, sentContent] = sendToSlackChannel.mock.calls[0]
    expect(sentContent).not.toContain('a low-confidence draft answer')
    expect(sentContent).toContain('a team member will follow up shortly')
  })

  it('still marks the ticket needs_human so the dashboard shows it for approval', async () => {
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'C123', [], 3, 'slack', 'general_question', [], 1, 'production', 'C123', undefined)

    expect(updateTicketAIDraftStatus).toHaveBeenCalledWith(1, 'needs_human')
  })

  it('Automatic Deflections off: genuinely low confidence still sends nothing to Slack', async () => {
    getIntegration.mockResolvedValue({ auto_deflect_enabled: 0, confidence_threshold: null })
    const { runAIAgent } = await import('@/lib/ai/agent')

    await runAIAgent(1, 'a question', 'C123', [], 3, 'slack', 'general_question', [], 1, 'production', 'C123', undefined)

    expect(sendToSlackChannel).not.toHaveBeenCalled()
    expect(updateTicketAIDraftStatus).toHaveBeenCalledWith(1, 'needs_human')
  })
})
