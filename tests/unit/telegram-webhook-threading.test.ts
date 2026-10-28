// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A Telegram reply points at the message it answers. That has to reach the
// pipeline as the thread id so the reply joins the ticket instead of opening
// another, including a reply to a reply and a ticket stored under the bare
// message id from before ids were namespaced by chat.

const h = vi.hoisted(() => ({
  processCommunityMessage: vi.fn(),
  getTicketBySourceMessageInChannel: vi.fn(),
  getTicketByThreadId: vi.fn(),
}))

vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: h.processCommunityMessage }))
vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketBySourceMessageInChannel: h.getTicketBySourceMessageInChannel,
  getTicketByThreadId: h.getTicketByThreadId,
}))
vi.mock('@/lib/db/queries/integrations', () => ({
  getIntegrationByBotSecret: vi.fn(async () => ({ org_id: 4 })),
  parseChannelIds: vi.fn(() => []),
}))
vi.mock('@/lib/ingest/limits', async (orig) => ({
  ...(await orig<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))

const CHAT = -1001

function update(message: Record<string, unknown>) {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'secret' },
    body: JSON.stringify({
      update_id: 1,
      message: { message_id: 50, chat: { id: CHAT, type: 'supergroup' }, from: { id: 7, first_name: 'Dana' }, date: 1, ...message },
    }),
  })
}

async function post(message: Record<string, unknown>) {
  const { POST } = await import('@/app/api/telegram/webhook/route')
  return POST(update(message) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getTicketBySourceMessageInChannel.mockResolvedValue(null)
  h.getTicketByThreadId.mockResolvedValue(null)
})

describe('Telegram webhook threading', () => {
  it('a message that is not a reply has no thread', async () => {
    await post({ text: 'how do I reset my password?' })
    expect(h.processCommunityMessage.mock.calls[0][0].threadId).toBeUndefined()
  })

  it('a reply carries the message it answers as its thread, namespaced by chat', async () => {
    await post({ text: 'how do I reset my password?', reply_to_message: { message_id: 41 } })
    expect(h.processCommunityMessage.mock.calls[0][0]).toMatchObject({
      messageId: `telegram:${CHAT}:50`,
      threadId: `telegram:${CHAT}:41`,
      platform: 'telegram',
    })
    expect(h.processCommunityMessage.mock.calls[0][1]).toBe(4)
  })

  it('a ticket stored under the bare message id is found by that id, and its stored id becomes the thread', async () => {
    h.getTicketBySourceMessageInChannel.mockImplementation(async (id: string) => (id === '41' ? { source_message_id: '41' } : null))
    await post({ text: 'how do I reset my password?', reply_to_message: { message_id: 41 } })
    expect(h.processCommunityMessage.mock.calls[0][0].threadId).toBe('41')
  })

  it('keeps a short reply in a tracked conversation and drops one that would open a ticket', async () => {
    h.getTicketByThreadId.mockResolvedValue({ id: 3 })
    await post({ text: 'thanks!', reply_to_message: { message_id: 41 } })
    expect(h.processCommunityMessage).toHaveBeenCalledTimes(1)

    h.processCommunityMessage.mockClear()
    h.getTicketByThreadId.mockResolvedValue(null)
    await post({ text: 'thanks!', reply_to_message: { message_id: 41 } })
    await post({ text: 'ok' })
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })
})
