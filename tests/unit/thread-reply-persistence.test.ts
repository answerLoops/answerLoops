// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression coverage for a real gap found live: a reply inside an existing
// Discord/Slack thread was always a brand-new message with its own unique
// id, so processCommunityMessage's dedup (exact messageId match only) never
// caught it — every reply fragmented into a disconnected new ticket instead
// of continuing the original conversation. Email already solved this
// correctly (RFC 5322 threading + recordCustomerReply); this generalizes
// the same recordCustomerReply append path to any platform that surfaces a
// thread id, via the pre-existing source_thread_id column, which the
// pipeline already wrote generically for every platform.
//
// The append path returns before triage/embedding/ticket-creation/the AI
// agent — none of those should run at all when a reply gets appended, both
// for correctness (a reply isn't a new ticket) and cost (re-triaging every
// follow-up in a live conversation would be wasteful). That's the most
// important thing this file proves — a source-string check can't tell
// "looks right" apart from "the expensive downstream calls actually never
// fired", so this mocks every pipeline dependency and asserts on call counts.

const {
  getTicketBySourceMessageId,
  getTicketByThreadId,
  recordCustomerReply,
  createTicket,
  createNotification,
  triageMessage,
  runAIAgent,
} = vi.hoisted(() => ({
  getTicketBySourceMessageId: vi.fn(),
  getTicketByThreadId: vi.fn(),
  recordCustomerReply: vi.fn(),
  createTicket: vi.fn(),
  createNotification: vi.fn(),
  triageMessage: vi.fn(),
  runAIAgent: vi.fn(),
}))

vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketBySourceMessageId,
  getTicketByThreadId,
  createTicket,
  recordCustomerReply,
}))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification }))
vi.mock('@/lib/ai/triage', () => ({ triageMessage }))
vi.mock('@/lib/ai/agent', () => ({ runAIAgent }))
vi.mock('@/lib/ai/models', () => ({ NoAIProviderConfiguredError: class extends Error {} }))
vi.mock('@/lib/sla/engine', () => ({
  calculateDeadlines: vi.fn(async () => ({ sla_response_deadline: null, sla_resolve_deadline: null })),
  checkSlaBreaches: vi.fn(async () => []),
}))
vi.mock('@/lib/push/notify', () => ({ sendPushToAll: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendNewTicketEmail: vi.fn(), sendSlaBreachEmails: vi.fn() }))
vi.mock('@/lib/ai/embed', () => ({ embedText: vi.fn(), EMBEDDING_MODEL: 'test-model' }))
vi.mock('@/lib/ai/related', () => ({ findRelated: vi.fn(() => []), isDuplicate: vi.fn(() => false) }))
vi.mock('@/lib/db/queries/embeddings', () => ({
  saveEmbedding: vi.fn(),
  getCandidateVectors: vi.fn(async () => []),
  replaceLinks: vi.fn(),
  getPriorAnswers: vi.fn(async () => []),
}))
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: vi.fn(async () => []) }))
vi.mock('@/lib/retry', () => ({ withRetry: vi.fn((fn: () => unknown) => fn()) }))
vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))

async function loadPipeline() {
  return import('@/lib/ingest/pipeline')
}

const EXISTING_TICKET = {
  id: 42,
  org_ticket_number: 7,
  status: 'open',
}

beforeEach(() => {
  vi.clearAllMocks()
  getTicketBySourceMessageId.mockResolvedValue(null)
  recordCustomerReply.mockResolvedValue(true)
})

describe('processCommunityMessage: thread replies append instead of creating a new ticket', () => {
  it('appends via recordCustomerReply and returns appended:true when threadId matches an existing ticket', async () => {
    getTicketByThreadId.mockResolvedValue(EXISTING_TICKET)
    const { processCommunityMessage } = await loadPipeline()

    const result = await processCommunityMessage(
      {
        messageId: 'msg-2',
        content: 'a follow-up reply in the thread',
        authorId: 'U1',
        authorName: 'nathan',
        channelId: 'C123',
        threadId: 'T123',
        platform: 'slack',
      },
      3
    )

    expect(result).toEqual({ ticket_id: 42, appended: true })
    expect(getTicketByThreadId).toHaveBeenCalledWith('T123', 3)
    expect(recordCustomerReply).toHaveBeenCalledWith(42, 'a follow-up reply in the thread', {
      authorName: expect.any(String),
      messageId: expect.any(String),
    })
  })

  it('notifies staff with the org-local ticket number, not the raw id', async () => {
    getTicketByThreadId.mockResolvedValue(EXISTING_TICKET)
    const { processCommunityMessage } = await loadPipeline()

    await processCommunityMessage(
      { messageId: 'msg-2', content: 'reply text', authorId: 'U1', authorName: 'nathan', channelId: 'C123', threadId: 'T123', platform: 'slack' },
      3
    )

    expect(createNotification).toHaveBeenCalledWith(
      'ticket_activity',
      expect.stringContaining('#7'),
      42,
      3
    )
  })

  it('never runs triage, creates a new ticket, or invokes the AI agent on an appended reply', async () => {
    getTicketByThreadId.mockResolvedValue(EXISTING_TICKET)
    const { processCommunityMessage } = await loadPipeline()

    await processCommunityMessage(
      { messageId: 'msg-2', content: 'reply text', authorId: 'U1', authorName: 'nathan', channelId: 'C123', threadId: 'T123', platform: 'slack' },
      3
    )

    expect(triageMessage).not.toHaveBeenCalled()
    expect(createTicket).not.toHaveBeenCalled()
    expect(runAIAgent).not.toHaveBeenCalled()
  })

  it('falls through to normal ticket creation when threadId is set but no existing ticket matches', async () => {
    getTicketByThreadId.mockResolvedValue(null)
    triageMessage.mockResolvedValue({
      category: 'general_question', severity_score: 0.3, summary: 'a new thread, first message', suggested_priority: 'medium', reasoning: 'x',
    })
    createTicket.mockResolvedValue({ id: 99, org_ticket_number: 1 })
    const { processCommunityMessage } = await loadPipeline()

    const result = await processCommunityMessage(
      { messageId: 'msg-1', content: 'the first message in a brand new thread', authorId: 'U1', authorName: 'nathan', channelId: 'C123', threadId: 'T999', platform: 'slack' },
      3
    )

    expect(recordCustomerReply).not.toHaveBeenCalled()
    expect(createTicket).toHaveBeenCalledTimes(1)
    expect(result.ticket_id).toBe(99)
    expect(result.appended).toBeUndefined()
  })

  it('skips the thread lookup entirely when the message carries no threadId (e.g. a top-level channel message)', async () => {
    triageMessage.mockResolvedValue({
      category: 'general_question', severity_score: 0.3, summary: 'no thread here', suggested_priority: 'medium', reasoning: 'x',
    })
    createTicket.mockResolvedValue({ id: 100, org_ticket_number: 2 })
    const { processCommunityMessage } = await loadPipeline()

    await processCommunityMessage(
      { messageId: 'msg-3', content: 'a plain top-level message, no thread', authorId: 'U1', authorName: 'nathan', channelId: 'C123', platform: 'slack' },
      3
    )

    expect(getTicketByThreadId).not.toHaveBeenCalled()
  })
})
