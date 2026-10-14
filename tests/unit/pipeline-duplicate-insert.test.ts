import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// A second delivery of the same message loses the (org_id, source_message_id)
// insert race; that is reported as a duplicate of the winning ticket rather
// than surfacing as a 500.

const p = vi.hoisted(() => ({
  createTicket: vi.fn(),
  getTicketBySourceMessageId: vi.fn(),
}))

// Importing the pipeline pulls in a large module graph; give the first import
// room so it cannot time out on a loaded machine.
const IMPORT_TIMEOUT_MS = 60_000

type Pipeline = typeof import('@/lib/ingest/pipeline')
let pipeline: Pipeline

beforeAll(async () => {
  vi.resetModules()
  vi.doMock('@/lib/db/queries/tickets', () => ({
    createTicket: p.createTicket,
    getTicketBySourceMessageId: p.getTicketBySourceMessageId,
    getTicketByThreadId: vi.fn(async () => null),
    recordCustomerReply: vi.fn(),
    updateTicketTriage: vi.fn(),
  }))
  for (const m of [
    '@/lib/ai/triage', '@/lib/db/queries/notifications', '@/lib/push/notify', '@/lib/email/send',
    '@/lib/ai/agent', '@/lib/channels/post-reply', '@/lib/ai/embed', '@/lib/ai/related', '@/lib/db/queries/embeddings',
    '@/lib/db/queries/kb', '@/lib/db/queries/ai-config', '@/lib/billing/platform-key-trial',
  ]) vi.doMock(m, () => new Proxy({}, { get: (_t, k) => (k === 'EMBEDDING_MODEL' ? 'm' : vi.fn(async () => ({}))) }))
  vi.doMock('@/lib/billing/plans', () => ({ getDeploymentMode: () => 'self-hosted' }))
  vi.doMock('@/lib/sla/engine', () => ({ calculateDeadlines: async () => ({}), checkSlaBreaches: async () => [] }))
  vi.doMock('next/server', () => ({ after: (fn: () => void) => fn }))
  pipeline = await import('@/lib/ingest/pipeline')
}, IMPORT_TIMEOUT_MS)

beforeEach(() => {
  p.createTicket.mockReset()
  p.getTicketBySourceMessageId.mockReset()
})

describe('pipeline: a unique violation on the composite key is a duplicate, not an error', () => {
  it('returns the winning ticket as a duplicate when the insert loses the race', async () => {
    const violation = Object.assign(new Error('insert failed'), { cause: { code: '23505' } })
    p.getTicketBySourceMessageId.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 99 })
    p.createTicket.mockRejectedValueOnce(violation)

    const result = await pipeline.processCommunityMessage(
      { messageId: 'dup-1', content: 'a message long enough', authorId: 'a', authorName: 'A', channelId: 'c', platform: 'discord' },
      4
    )
    expect(result).toEqual({ ticket_id: 99, duplicate: true })
    expect(p.getTicketBySourceMessageId).toHaveBeenLastCalledWith('dup-1', 4)
  })

  it('rethrows any other insert failure', async () => {
    p.getTicketBySourceMessageId.mockResolvedValue(null)
    p.createTicket.mockRejectedValueOnce(new Error('connection lost'))
    await expect(
      pipeline.processCommunityMessage({ messageId: 'x', content: 'a message long enough', authorId: 'a', authorName: 'A', channelId: 'c' }, 4)
    ).rejects.toThrow('connection lost')
  })
})
