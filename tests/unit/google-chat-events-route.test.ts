import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PipelineResult } from '@/lib/ingest/pipeline'

// app/api/google-chat/events/route.ts — the HTTP endpoint Google Chat posts
// events to. Covers: the /connect pairing command, routing a regular
// message to the shared ingest pipeline once a space is paired, ignoring
// messages from an unpaired space, and the short-message noise filter
// (mirroring Slack's, but without dropping a tracked thread reply).

const {
  getIntegrationByGoogleChatSpace,
  completeGoogleChatPairing,
  getTicketByThreadId,
  processCommunityMessage,
} = vi.hoisted(() => ({
  getIntegrationByGoogleChatSpace: vi.fn(),
  completeGoogleChatPairing: vi.fn(async (_code: string, _space: string): Promise<{ status: string; orgId?: number }> => ({ status: 'invalid' })),
  getTicketByThreadId: vi.fn(async (): Promise<{ id: number } | null> => null),
  processCommunityMessage: vi.fn(async (): Promise<PipelineResult> => ({ ticket_id: 42 })),
}))

vi.mock('@/lib/db/queries/integrations', () => ({
  getIntegrationByGoogleChatSpace,
  completeGoogleChatPairing,
}))
vi.mock('@/lib/ingest/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketByThreadId }))
vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage }))
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: true })) // skip real token verification in tests

function req(body: unknown): Request {
  return new Request('https://app.example.com/api/google-chat/events', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/google-chat/events', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ignores non-MESSAGE events (e.g. ADDED_TO_SPACE) without touching the DB', async () => {
    const { POST } = await import('@/app/api/google-chat/events/route')
    const res = await POST(req({ type: 'ADDED_TO_SPACE', space: { name: 'spaces/AAAA' } }))
    expect(res.status).toBe(200)
    expect(getIntegrationByGoogleChatSpace).not.toHaveBeenCalled()
    expect(processCommunityMessage).not.toHaveBeenCalled()
  })

  it('pairs a valid /connect code to the posting space and replies with confirmation', async () => {
    completeGoogleChatPairing.mockResolvedValue({ status: 'paired', orgId: 7 })
    const { POST } = await import('@/app/api/google-chat/events/route')

    const res = await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
      message: { name: 'spaces/AAAA/messages/1', text: '/connect gc_abc123' },
    }))

    const json = await res.json()
    expect(completeGoogleChatPairing).toHaveBeenCalledWith('gc_abc123', 'spaces/AAAA')
    expect(json.text).toContain('connected')
    expect(processCommunityMessage).not.toHaveBeenCalled()
  })

  it('rejects an unrecognized, expired or already-used /connect code', async () => {
    completeGoogleChatPairing.mockResolvedValue({ status: 'invalid' })
    const { POST } = await import('@/app/api/google-chat/events/route')

    const res = await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
      message: { name: 'spaces/AAAA/messages/1', text: '/connect wrong-code' },
    }))

    const json = await res.json()
    expect(json.text).toContain("wasn't recognized or has expired")
    expect(getIntegrationByGoogleChatSpace).not.toHaveBeenCalled()
    expect(processCommunityMessage).not.toHaveBeenCalled()
  })

  it('tells the admin when the space already belongs to another workspace', async () => {
    completeGoogleChatPairing.mockResolvedValue({ status: 'space_in_use' })
    const { POST } = await import('@/app/api/google-chat/events/route')

    const res = await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
      message: { name: 'spaces/AAAA/messages/1', text: '/connect gc_abc123' },
    }))

    expect((await res.json()).text).toContain('already connected')
  })

  it('rejects a body larger than the webhook cap before parsing it', async () => {
    const { POST } = await import('@/app/api/google-chat/events/route')
    const res = await POST(new Request('https://app.example.com/api/google-chat/events', {
      method: 'POST',
      body: 'x'.repeat(1_000_001),
    }))
    expect(res.status).toBe(413)
    expect(processCommunityMessage).not.toHaveBeenCalled()
  })

  it('ignores a message from a space that is not paired to any org', async () => {
    getIntegrationByGoogleChatSpace.mockResolvedValue(null)
    const { POST } = await import('@/app/api/google-chat/events/route')

    await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/UNPAIRED' },
      message: { name: 'spaces/UNPAIRED/messages/1', text: 'A real question that is long enough' },
    }))

    expect(processCommunityMessage).not.toHaveBeenCalled()
  })

  it('routes a real message from a paired space into the shared ingest pipeline', async () => {
    getIntegrationByGoogleChatSpace.mockResolvedValue({ org_id: 7 })
    const { POST } = await import('@/app/api/google-chat/events/route')

    const res = await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
      message: {
        name: 'spaces/AAAA/messages/1',
        text: 'How do I configure the widget on my site?',
        sender: { name: 'users/123', displayName: 'Jamie' },
      },
    }))

    expect(processCommunityMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'spaces/AAAA/messages/1',
        content: 'How do I configure the widget on my site?',
        authorId: 'users/123',
        authorName: 'Jamie',
        channelId: 'spaces/AAAA',
        platform: 'google_chat',
      }),
      7
    )

    // Google Chat renders the synchronous response as a Message resource —
    // a body without a `text` field (like the old `{ ok: true, ...result }`
    // shape) shows the app as "not responding" in the client regardless of
    // how fast it arrived. This is the regression test for that bug.
    const json = await res.json()
    expect(typeof json.text).toBe('string')
    expect(json.text.length).toBeGreaterThan(0)
  })

  it('drops a short message that is not a tracked thread reply, same noise filter as Slack', async () => {
    getIntegrationByGoogleChatSpace.mockResolvedValue({ org_id: 7 })
    getTicketByThreadId.mockResolvedValue(null)
    const { POST } = await import('@/app/api/google-chat/events/route')

    await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
      message: { name: 'spaces/AAAA/messages/1', text: 'ok', thread: { name: 'spaces/AAAA/threads/BBBB' } },
    }))

    expect(processCommunityMessage).not.toHaveBeenCalled()
  })

  it('keeps a short message when it is a reply inside an already-tracked thread, and acks with the appended-specific text in the same thread', async () => {
    getIntegrationByGoogleChatSpace.mockResolvedValue({ org_id: 7 })
    getTicketByThreadId.mockResolvedValue({ id: 1 })
    processCommunityMessage.mockResolvedValueOnce({ ticket_id: 1, appended: true })
    const { POST } = await import('@/app/api/google-chat/events/route')

    const res = await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
      message: { name: 'spaces/AAAA/messages/2', text: 'ok', thread: { name: 'spaces/AAAA/threads/BBBB' } },
    }))

    expect(processCommunityMessage).toHaveBeenCalled()
    const json = await res.json()
    expect(json.text).toContain('follow-up')
    expect(json.thread).toEqual({ name: 'spaces/AAAA/threads/BBBB' })
  })

  it('folds an attachment into a [Attachment: name] — url line instead of dropping it, same format Slack uses', async () => {
    getIntegrationByGoogleChatSpace.mockResolvedValue({ org_id: 7 })
    const { POST } = await import('@/app/api/google-chat/events/route')

    await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
      message: {
        name: 'spaces/AAAA/messages/1',
        text: 'Here is a screenshot of the error',
        attachment: [{ contentName: 'error.png', downloadUri: 'https://chat.google.com/files/error.png' }],
      },
    }))

    expect(processCommunityMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Here is a screenshot of the error\n\n[Attachment: error.png] — https://chat.google.com/files/error.png',
      }),
      7
    )
  })

  it('does not drop an attachment-only message with no caption text', async () => {
    getIntegrationByGoogleChatSpace.mockResolvedValue({ org_id: 7 })
    const { POST } = await import('@/app/api/google-chat/events/route')

    await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
      message: {
        name: 'spaces/AAAA/messages/1',
        attachment: [{ contentName: 'screenshot.png', downloadUri: 'https://chat.google.com/files/screenshot.png' }],
      },
    }))

    expect(processCommunityMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '[Attachment: screenshot.png] — https://chat.google.com/files/screenshot.png',
      }),
      7
    )
  })

  it('still drops a truly empty message (no text, no attachment)', async () => {
    getIntegrationByGoogleChatSpace.mockResolvedValue({ org_id: 7 })
    const { POST } = await import('@/app/api/google-chat/events/route')

    await POST(req({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
      message: { name: 'spaces/AAAA/messages/1' },
    }))

    expect(processCommunityMessage).not.toHaveBeenCalled()
  })
})
