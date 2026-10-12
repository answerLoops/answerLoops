import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Real bug found live in prod (ticket #14, org 3, Slack channel C0BM9UG0A3X):
// a customer posted a screenshot in a tracked thread and neither the image
// nor the reply ever reached the ticket. Root cause, in
// app/api/slack/events/route.ts: the noise filter
// `if (!text || text.length < 10) return` ran unconditionally, before any
// check for an attached file or an existing thread. Slack's `file_share`
// messages routinely carry empty/short `text` (the content IS the file),
// and a short reply in an already-tracked thread ("yes", or just an image
// with no caption) was silently dropped the exact same way. Nothing was
// ever wrong with getTicketByThreadId/recordCustomerReply themselves — the
// message never got that far. Fixed by: (1) extracting `ev.files` into
// permalink lines so an attachment survives into ticket content even with
// no caption, and (2) only applying the length filter to messages that
// would start a brand-new ticket, never to a reply in a thread already
// mapped to a ticket.

const { getTicketByThreadId, processCommunityMessage, getSlackPermalink, getIntegrationByTeamId } = vi.hoisted(() => ({
  getTicketByThreadId: vi.fn(),
  processCommunityMessage: vi.fn().mockResolvedValue({ ticket_id: 1 }),
  getSlackPermalink: vi.fn().mockResolvedValue(null),
  getIntegrationByTeamId: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/ingest/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketByThreadId }))
vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage }))
vi.mock('@/lib/slack/permalink', () => ({ getSlackPermalink }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegrationByTeamId }))
vi.mock('@/lib/db/queries/feedback', () => ({
  saveFeedback: vi.fn(),
  getTicketIdByAnswerMessage: vi.fn(),
}))
vi.mock('@/lib/db/queries/csat', () => ({
  getTicketIdByCsatMessage: vi.fn(),
  saveCsatRating: vi.fn(),
}))

function makeRequest(event: Record<string, unknown>): Request {
  return new Request('http://localhost/api/slack/events', {
    method: 'POST',
    body: JSON.stringify({ type: 'event_callback', team_id: 'T1', event }),
  })
}

describe('app/api/slack/events/route.ts — attachment content + short-thread-reply noise filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    processCommunityMessage.mockResolvedValue({ ticket_id: 1 })
    getTicketByThreadId.mockResolvedValue(null)
    process.env.MOCK_EXTERNALS = '1'
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.MOCK_EXTERNALS
  })

  it('a file_share message with no text still creates a ticket, carrying the attachment permalink as content', async () => {
    const { POST } = await import('@/app/api/slack/events/route')
    await POST(makeRequest({
      type: 'message',
      subtype: 'file_share',
      channel: 'C1',
      user: 'U1',
      ts: '111.222',
      text: '',
      files: [{ name: 'screenshot.png', permalink: 'https://files.slack.com/files-pri/T1-F1/screenshot.png' }],
    }))

    expect(processCommunityMessage).toHaveBeenCalledTimes(1)
    const [payload] = processCommunityMessage.mock.calls[0]
    expect(payload.content).toContain('screenshot.png')
    expect(payload.content).toContain('https://files.slack.com/files-pri/T1-F1/screenshot.png')
  })

  it('a short reply ("yes") in a thread already mapped to a ticket is not dropped', async () => {
    getTicketByThreadId.mockResolvedValue({ id: 58, org_ticket_number: 14 })
    const { POST } = await import('@/app/api/slack/events/route')
    await POST(makeRequest({
      type: 'message',
      channel: 'C1',
      user: 'U1',
      ts: '333.444',
      thread_ts: '111.222',
      text: 'yes',
    }))

    expect(processCommunityMessage).toHaveBeenCalledTimes(1)
    const [payload] = processCommunityMessage.mock.calls[0]
    expect(payload.content).toBe('yes')
    expect(payload.threadId).toBe('111.222')
  })

  it('a brand-new short message with no thread and no file is still dropped as noise', async () => {
    getTicketByThreadId.mockResolvedValue(null)
    const { POST } = await import('@/app/api/slack/events/route')
    await POST(makeRequest({
      type: 'message',
      channel: 'C1',
      user: 'U1',
      ts: '555.666',
      text: 'thanks',
    }))

    expect(processCommunityMessage).not.toHaveBeenCalled()
  })

  it('an empty message with no files and no thread is dropped, not passed through as empty content', async () => {
    const { POST } = await import('@/app/api/slack/events/route')
    await POST(makeRequest({
      type: 'message',
      channel: 'C1',
      user: 'U1',
      ts: '777.888',
      text: '',
    }))

    expect(processCommunityMessage).not.toHaveBeenCalled()
  })
})
