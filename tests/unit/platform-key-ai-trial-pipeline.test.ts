import { describe, it, expect, vi, beforeEach } from 'vitest'

// Behavioral coverage for the platform-key trial decision inside
// processCommunityMessage (lib/ingest/pipeline.ts): a brand-new org with no
// AI provider configured gets 5 lifetime free tickets fully AI-processed on
// answerLoops' own key. The static structural checks live in
// platform-key-ai-trial.test.ts — this file proves the actual runtime
// decision (which purpose gets threaded to triage/embed/agent) for each
// combination of "has own key" / "deployment mode" / "trial remaining",
// since a source-string check can't tell "looks right" apart from "the
// right branch actually fires for the right inputs".

const {
  getTicketBySourceMessageId,
  getTicketByThreadId,
  createTicket,
  triageMessage,
  orgHasAIKey,
  reservePlatformKeyTrial,
  getDeploymentMode,
  embedText,
  runAIAgent,
  pendingAfter,
} = vi.hoisted(() => ({
  getTicketBySourceMessageId: vi.fn(),
  getTicketByThreadId: vi.fn(),
  createTicket: vi.fn(),
  triageMessage: vi.fn(),
  orgHasAIKey: vi.fn(),
  reservePlatformKeyTrial: vi.fn(),
  getDeploymentMode: vi.fn(),
  embedText: vi.fn(),
  runAIAgent: vi.fn(),
  // pipeline.ts's real after() runs its callback fire-and-forget — it is
  // never awaited by processCommunityMessage itself, matching Next.js's
  // real after() semantics. Awaiting processCommunityMessage alone is not
  // enough to observe anything that happens inside that callback (like the
  // runAIAgent call): the mocked after() below stashes each callback's
  // promise here so a test can explicitly drain it with flushAfter().
  pendingAfter: [] as Promise<unknown>[],
}))

function flushAfter() {
  const pending = pendingAfter.splice(0)
  return Promise.all(pending)
}

vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketBySourceMessageId,
  getTicketByThreadId,
  createTicket,
  recordCustomerReply: vi.fn(),
  updateTicketTriage: vi.fn(),
}))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/ai/triage', () => ({ triageMessage }))
vi.mock('@/lib/db/queries/ai-config', () => ({ orgHasAIKey }))
vi.mock('@/lib/billing/platform-key-trial', () => ({ reservePlatformKeyTrial }))
vi.mock('@/lib/billing/plans', () => ({ getDeploymentMode }))
vi.mock('@/lib/ai/agent', () => ({ runAIAgent }))
vi.mock('@/lib/ai/models', () => ({ NoAIProviderConfiguredError: class extends Error {} }))
vi.mock('@/lib/sla/engine', () => ({
  calculateDeadlines: vi.fn(async () => ({ sla_response_deadline: null, sla_resolve_deadline: null })),
  checkSlaBreaches: vi.fn(async () => []),
}))
vi.mock('@/lib/push/notify', () => ({ sendPushToAll: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendNewTicketEmail: vi.fn(), sendSlaBreachEmails: vi.fn() }))
vi.mock('@/lib/ai/embed', () => ({ embedText, EMBEDDING_MODEL: 'test-model' }))
vi.mock('@/lib/ai/related', () => ({ findRelated: vi.fn(() => []), isDuplicate: vi.fn(() => false) }))
vi.mock('@/lib/db/queries/embeddings', () => ({
  saveEmbedding: vi.fn(),
  getCandidateVectors: vi.fn(async () => []),
  replaceLinks: vi.fn(),
  getPriorAnswers: vi.fn(async () => []),
}))
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: vi.fn(async () => []) }))
vi.mock('@/lib/retry', () => ({ withRetry: vi.fn((fn: () => unknown) => fn()) }))
vi.mock('next/server', () => ({
  after: (fn: () => Promise<unknown>) => { pendingAfter.push(fn()) },
}))

const MESSAGE = {
  messageId: 'msg-1',
  content: 'a brand new test message',
  authorId: 'U1',
  authorName: 'nathan',
  channelId: 'C123',
  platform: 'slack' as const,
}

const API_MESSAGE = {
  ...MESSAGE,
  platform: 'mcp' as const,
  waitForEnrichment: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  pendingAfter.splice(0)
  getTicketBySourceMessageId.mockResolvedValue(null)
  getTicketByThreadId.mockResolvedValue(null)
  triageMessage.mockResolvedValue({
    category: 'general_question',
    severity_score: 0.3,
    summary: 'a brand new test message',
    suggested_priority: 'medium',
    reasoning: 'x',
  })
  createTicket.mockResolvedValue({
    id: 1,
    org_ticket_number: 1,
    content: 'a brand new test message',
    category: 'general_question',
    ai_summary: 'a brand new test message',
    source_author_name: 'nathan',
    source_platform: 'slack',
    source_channel_id: 'C123',
    source_thread_id: null,
  })
  embedText.mockResolvedValue([0.1, 0.2])
})

async function loadPipeline() {
  return import('@/lib/ingest/pipeline')
}

describe('processCommunityMessage: platform-key trial behavior', () => {
  it('reserves and uses the trial when the org has no key, is on cloud, and has trial remaining', async () => {
    getDeploymentMode.mockReturnValue('cloud')
    orgHasAIKey.mockResolvedValue(false)
    reservePlatformKeyTrial.mockResolvedValue(true)
    const { processCommunityMessage } = await loadPipeline()

    await processCommunityMessage(MESSAGE, 3)

    expect(reservePlatformKeyTrial).toHaveBeenCalledWith(3)
    expect(triageMessage).toHaveBeenCalledWith('a brand new test message', 3, 'trial')
  })

  it('falls back to production purpose once the trial is exhausted (reservation denied)', async () => {
    getDeploymentMode.mockReturnValue('cloud')
    orgHasAIKey.mockResolvedValue(false)
    reservePlatformKeyTrial.mockResolvedValue(false)
    const { processCommunityMessage } = await loadPipeline()

    await processCommunityMessage(MESSAGE, 3)

    expect(triageMessage).toHaveBeenCalledWith('a brand new test message', 3, 'production')
  })

  it('never attempts a trial reservation when the org already has its own AI key', async () => {
    getDeploymentMode.mockReturnValue('cloud')
    orgHasAIKey.mockResolvedValue(true)
    const { processCommunityMessage } = await loadPipeline()

    await processCommunityMessage(MESSAGE, 3)

    expect(reservePlatformKeyTrial).not.toHaveBeenCalled()
    expect(triageMessage).toHaveBeenCalledWith('a brand new test message', 3, 'production')
  })

  it('never attempts a trial reservation on self-hosted deployments', async () => {
    getDeploymentMode.mockReturnValue('self-hosted')
    const { processCommunityMessage } = await loadPipeline()

    await processCommunityMessage(MESSAGE, 3)

    expect(orgHasAIKey).not.toHaveBeenCalled()
    expect(reservePlatformKeyTrial).not.toHaveBeenCalled()
    expect(triageMessage).toHaveBeenCalledWith('a brand new test message', 3, 'production')
  })

  it('passes the same trial purpose to the async runAIAgent call as it did to triage', async () => {
    getDeploymentMode.mockReturnValue('cloud')
    orgHasAIKey.mockResolvedValue(false)
    reservePlatformKeyTrial.mockResolvedValue(true)
    const { processCommunityMessage } = await loadPipeline()

    await processCommunityMessage(MESSAGE, 3)
    await flushAfter()

    expect(runAIAgent).toHaveBeenCalledWith(
      1,
      'a brand new test message',
      'C123',
      expect.any(Array),
      3,
      'slack',
      'general_question',
      expect.any(Array),
      1,
      'trial',
      'C123',
      undefined
    )
  })

  it('waits for API-created tickets to finish enrichment before returning', async () => {
    getDeploymentMode.mockReturnValue('cloud')
    orgHasAIKey.mockResolvedValue(true)
    createTicket.mockResolvedValue({
      id: 1,
      org_ticket_number: 1,
      content: 'a brand new test message',
      category: 'general_question',
      ai_summary: 'a brand new test message',
      source_author_name: 'nathan',
      source_platform: 'mcp',
      source_channel_id: 'C123',
      source_thread_id: null,
    })
    const { processCommunityMessage } = await loadPipeline()

    await processCommunityMessage(API_MESSAGE, 3)

    expect(runAIAgent).toHaveBeenCalledWith(
      1,
      'a brand new test message',
      'C123',
      expect.any(Array),
      3,
      'mcp',
      'general_question',
      expect.any(Array),
      1,
      'production',
      'C123',
      undefined
    )
    expect(pendingAfter).toHaveLength(0)
  })
})
