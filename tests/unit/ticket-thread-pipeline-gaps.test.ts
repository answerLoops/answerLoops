// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pipeline-level behavior of the thread change that the channel-level tests
// do not pin down: a redelivered reply must stop at the append step (no new
// ticket, no triage, no staff notification), and a maintainer's context
// message is size-capped like every other inbound message.

const h = vi.hoisted(() => ({
  getTicketBySourceMessageId: vi.fn(),
  getTicketByThreadId: vi.fn(),
  recordCustomerReply: vi.fn(),
  recordThreadContext: vi.fn(),
  createTicket: vi.fn(),
  createNotification: vi.fn(),
  triageMessage: vi.fn(),
  sendPushToAll: vi.fn(),
}))

vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketBySourceMessageId: h.getTicketBySourceMessageId,
  getTicketByThreadId: h.getTicketByThreadId,
  recordCustomerReply: h.recordCustomerReply,
  recordThreadContext: h.recordThreadContext,
  createTicket: h.createTicket,
  updateTicketTriage: vi.fn(),
}))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification: h.createNotification }))
vi.mock('@/lib/ai/triage', () => ({ triageMessage: h.triageMessage }))
vi.mock('@/lib/ai/agent', () => ({ runAIAgent: vi.fn() }))
vi.mock('@/lib/ai/models', () => ({ NoAIProviderConfiguredError: class extends Error {} }))
vi.mock('@/lib/sla/engine', () => ({
  calculateDeadlines: vi.fn(async () => ({ sla_response_deadline: null, sla_resolve_deadline: null })),
  checkSlaBreaches: vi.fn(async () => []),
}))
vi.mock('@/lib/push/notify', () => ({ sendPushToAll: h.sendPushToAll }))
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

const TICKET = { id: 42, org_ticket_number: 7, status: 'open' }
const payload = {
  messageId: 'm-2',
  content: 'a follow-up reply in the thread',
  authorId: 'u1',
  authorName: 'alice',
  channelId: 'c1',
  threadId: 'root-1',
  platform: 'slack' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getTicketBySourceMessageId.mockResolvedValue(null)
  h.getTicketByThreadId.mockResolvedValue(TICKET)
})

describe('processCommunityMessage when the reply is already stored', () => {
  it('reports a duplicate and does not notify, push, triage or open a ticket', async () => {
    h.recordCustomerReply.mockResolvedValue(false)
    const { processCommunityMessage } = await import('@/lib/ingest/pipeline')
    const result = await processCommunityMessage(payload, 3)

    expect(result).toEqual({ ticket_id: 42, duplicate: true })
    expect(h.createNotification).not.toHaveBeenCalled()
    expect(h.sendPushToAll).not.toHaveBeenCalled()
    expect(h.triageMessage).not.toHaveBeenCalled()
    expect(h.createTicket).not.toHaveBeenCalled()
  })

  it('a stored reply is reported as appended, not duplicate', async () => {
    h.recordCustomerReply.mockResolvedValue(true)
    const { processCommunityMessage } = await import('@/lib/ingest/pipeline')
    const result = await processCommunityMessage(payload, 3)

    expect(result).toMatchObject({ ticket_id: 42, appended: true })
    expect(result).not.toHaveProperty('duplicate')
    expect(h.createNotification).toHaveBeenCalledTimes(1)
  })
})

describe('recordThreadContextMessage', () => {
  it('caps an oversized maintainer message like any other inbound content', async () => {
    h.recordThreadContext.mockResolvedValue(true)
    const { MAX_INGEST_CONTENT_CHARS } = await import('@/lib/ingest/limits')
    const { recordThreadContextMessage } = await import('@/lib/ingest/pipeline')
    const stored = await recordThreadContextMessage(
      { messageId: 'm-9', content: 'x'.repeat(MAX_INGEST_CONTENT_CHARS + 500), authorName: 'maint', threadId: 'root-1' },
      3
    )

    expect(stored).toBe(true)
    const [ticketId, content, input] = h.recordThreadContext.mock.calls[0]
    expect(ticketId).toBe(42)
    expect(content).toHaveLength(MAX_INGEST_CONTENT_CHARS)
    expect(input).toEqual({ authorName: 'maint', messageId: 'm-9' })
    expect(h.getTicketByThreadId).toHaveBeenCalledWith('root-1', 3)
  })
})
