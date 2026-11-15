import { describe, it, expect, vi, beforeEach } from 'vitest'

// A triage failure used to be rethrown, which stopped enrichment before the
// notification and the AI answer. It should keep the placeholder and go on.

const m = vi.hoisted(() => ({
  triageMessage: vi.fn(),
  runAIAgent: vi.fn(async (..._args: unknown[]) => undefined),
  createNotification: vi.fn(async () => undefined),
  updateTicketTriage: vi.fn(async () => undefined),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))
vi.mock('@/lib/ai/triage', () => ({ triageMessage: m.triageMessage }))
vi.mock('@/lib/ai/models', () => ({
  NoAIProviderConfiguredError: class NoAIProviderConfiguredError extends Error {},
}))
vi.mock('@/lib/db/queries/tickets', () => ({
  createTicket: vi.fn(),
  getTicketBySourceMessageId: vi.fn(),
  getTicketByThreadId: vi.fn(),
  recordCustomerReply: vi.fn(),
  recordThreadContext: vi.fn(),
  updateTicketTriage: m.updateTicketTriage,
}))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification: m.createNotification }))
vi.mock('@/lib/sla/engine', () => ({
  calculateDeadlines: vi.fn(async () => ({ sla_response_deadline: null, sla_resolve_deadline: null })),
  checkSlaBreaches: vi.fn(async () => []),
}))
vi.mock('@/lib/push/notify', () => ({ sendPushToAll: vi.fn(async () => undefined) }))
vi.mock('@/lib/tickets/notify-activity', () => ({ notifyTicketActivity: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendNewTicketEmail: vi.fn(async () => undefined), sendSlaBreachEmails: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai/agent', () => ({ runAIAgent: m.runAIAgent }))
vi.mock('@/lib/channels/post-reply', () => ({ sendKeepAlive: vi.fn() }))
vi.mock('@/lib/ai/embed', () => ({ embedTextWithModel: vi.fn(async () => ({ embedding: [0.1, 0.2], model: 'm' })) }))
vi.mock('@/lib/ai/related', () => ({ findRelated: vi.fn(() => []), isDuplicate: vi.fn(() => false) }))
vi.mock('@/lib/db/queries/embeddings', () => ({
  saveEmbedding: vi.fn(),
  getCandidateVectors: vi.fn(async () => []),
  replaceLinks: vi.fn(),
  getPriorAnswers: vi.fn(async () => []),
}))
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: vi.fn(async () => []) }))
vi.mock('@/lib/logger', () => ({ logger: m.logger }))
vi.mock('@/lib/retry', () => ({ withRetry: (fn: () => unknown) => fn() }))

import { runBackgroundEnrichment } from '@/lib/ingest/pipeline'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import type { Ticket } from '@/types'

const ticket = {
  id: 7,
  content: 'I cannot open my old email. How do I get back into my account?',
  org_ticket_number: 3,
  source_author_name: 'new_member',
  source_platform: 'discourse',
  source_channel_id: '5',
  source_thread_id: '42',
  category: null,
  ai_summary: null,
  priority: 'medium',
  severity_score: 0.5,
} as unknown as Ticket

beforeEach(() => vi.clearAllMocks())

describe('runBackgroundEnrichment when triage fails', () => {
  it('still drafts the answer after an unexpected triage failure', async () => {
    m.triageMessage.mockRejectedValue(new Error('Structured output validation failed: reasoning too long'))
    await runBackgroundEnrichment(ticket, 1)

    expect(m.runAIAgent).toHaveBeenCalledTimes(1)
    // the ticket keeps its placeholder classification
    expect(m.runAIAgent.mock.calls[0][6]).toBe('general_question')
    expect(m.updateTicketTriage).not.toHaveBeenCalled()
  })

  it('still notifies the team about the new question', async () => {
    m.triageMessage.mockRejectedValue(new Error('boom'))
    await runBackgroundEnrichment(ticket, 1)
    expect(m.createNotification).toHaveBeenCalledWith('new_question', expect.stringContaining('new_member'), 7, 1)
  })

  it('records the failure at error level, and does not log it as an abandoned job', async () => {
    m.triageMessage.mockRejectedValue(new Error('boom'))
    await runBackgroundEnrichment(ticket, 1)
    expect(m.logger.error).toHaveBeenCalledWith('triage failed — continuing with the placeholder triage', expect.objectContaining({ ticketId: 7 }))
    expect(m.logger.error).not.toHaveBeenCalledWith('background enrichment job failed unexpectedly', expect.anything())
  })

  it('a missing AI provider is still only a warning, and enrichment still continues', async () => {
    m.triageMessage.mockRejectedValue(new NoAIProviderConfiguredError(1))
    await runBackgroundEnrichment(ticket, 1)
    expect(m.logger.warn).toHaveBeenCalledWith('no AI provider configured — leaving ticket untriaged', expect.anything())
    expect(m.runAIAgent).toHaveBeenCalledTimes(1)
  })

  it('a successful triage is applied to the ticket and passed on to the answer step', async () => {
    m.triageMessage.mockResolvedValue({ category: 'how_to', severity_score: 0.3, summary: 'Account recovery', suggested_priority: 'low', reasoning: 'r' })
    await runBackgroundEnrichment(ticket, 1)
    expect(m.updateTicketTriage).toHaveBeenCalledWith(7, expect.objectContaining({ category: 'how_to', ai_summary: 'Account recovery' }))
    expect(m.runAIAgent.mock.calls[0][6]).toBe('how_to')
  })
})
