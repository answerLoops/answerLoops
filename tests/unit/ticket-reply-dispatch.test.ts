import { describe, it, expect, vi, beforeEach } from 'vitest'

// lib/actions/tickets.ts's postReplyAction and updateAIDraftAction's
// approve/edit branches all route through one shared sendReply() helper
// (lib/channels/post-reply.ts) as of the Automatic Deflections toggle.
// Before this, `approve` only ever sent anything for GitHub — every other
// platform updated the DB status and sent nothing — and `edit` had the same
// gap for slack/telegram/email specifically (github/google_chat/discord
// were already wired). These tests cover both previously-broken paths now
// actually delivering, across every platform.

const {
  sendToSlackChannel,
  sendToTelegramChat,
  sendEmailReply,
  sendToChannel,
  postToDiscourseTopic,
  createComment,
  getRepoByOwnerAndName,
  getTicketById,
  updateTicketAIDraftStatus,
  auth,
} = vi.hoisted(() => ({
  sendToSlackChannel: vi.fn(async (_channel: string, _content: string, _orgId: number, _threadTs?: string) => 'slack-msg-id'),
  sendToTelegramChat: vi.fn(async (_channelId: string, _content: string, _orgId: number) => 'telegram-msg-id'),
  sendEmailReply: vi.fn(async (_channelId: string, _content: string, _orgId: number, _ticketId?: number) => 'email-msg-id'),
  sendToChannel: vi.fn(async (_channelId: string, _content: string, _orgId: number) => 'discord-msg-id'),
  postToDiscourseTopic: vi.fn(async (_topicId: string, _content: string, _orgId: number) => 'discourse-post-id'),
  createComment: vi.fn(async (_params: { owner: string; repo: string; issue_number: number; body: string }) => ({ data: { id: 999 } })),
  getRepoByOwnerAndName: vi.fn(async () => ({ id: 1, org_id: 3, installation_id: 42 })),
  getTicketById: vi.fn(),
  updateTicketAIDraftStatus: vi.fn(),
  auth: vi.fn(async () => ({ orgId: 3, user: { id: '1' } })),
}))

vi.mock('@/auth', () => ({ auth }))
vi.mock('@/lib/slack/send', () => ({ sendToSlackChannel }))
vi.mock('@/lib/telegram/send', () => ({ sendToTelegramChat }))
vi.mock('@/lib/email/reply', () => ({ sendEmailReply }))
vi.mock('@/lib/discord/send', () => ({ sendToChannel }))
vi.mock('@/lib/google-chat/send', () => ({ sendToGoogleChatSpace: vi.fn() }))
vi.mock('@/lib/discourse/send', () => ({ postToDiscourseTopic }))
vi.mock('@/lib/db/queries/github', () => ({ getRepoByOwnerAndName }))
vi.mock('@/lib/github/app', () => ({
  getInstallationOctokitById: vi.fn(async () => ({ rest: { issues: { createComment } } })),
}))
vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketById,
  addTicketReply: vi.fn(),
  updateTicketStatus: vi.fn(),
  updateTicketAIDraftStatus,
}))
vi.mock('@/lib/email/send', () => ({ sendTicketResolvedEmail: vi.fn() }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    org_ticket_number: 1,
    source_platform: 'slack',
    source_channel_id: 'C123',
    source_thread_id: null,
    source_message_id: null,
    ai_draft: 'the approved answer',
    ...overrides,
  }
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('updateAIDraftAction: approve now sends on every platform, not just GitHub', () => {
  beforeEach(() => vi.clearAllMocks())

  it('approve posts the real draft to Slack (previously sent nothing)', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'slack' }))
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'approve' }))

    expect(sendToSlackChannel).toHaveBeenCalled()
    expect(sendToSlackChannel.mock.calls[0][1]).toBe('the approved answer')
  })

  it('approve posts the real draft to Telegram (previously sent nothing)', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'telegram', source_channel_id: '-100123' }))
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'approve' }))

    expect(sendToTelegramChat).toHaveBeenCalledWith('-100123', 'the approved answer', 3)
  })

  it('approve posts the real draft by email (previously sent nothing)', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'email', source_channel_id: 'sender@example.com' }))
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'approve' }))

    expect(sendEmailReply).toHaveBeenCalledWith('sender@example.com', 'the approved answer', 3, 1)
  })

  it('approve posts a GitHub issue comment via Octokit (already worked, now via the shared module)', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'github', source_channel_id: 'owner/repo', source_message_id: 'github-issue-42' }))
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'approve' }))

    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'repo', issue_number: 42, body: 'the approved answer' })
    )
  })

  it('approve posts the real draft into the Discourse topic (routes channelId = source_thread_id)', async () => {
    getTicketById.mockResolvedValue(
      ticket({ source_platform: 'discourse', source_channel_id: '12', source_thread_id: '345' })
    )
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'approve' }))

    expect(postToDiscourseTopic).toHaveBeenCalledWith('345', 'the approved answer', 3)
  })

  it('approve never sends for an mcp-originated ticket — no live channel to post into', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'mcp', source_channel_id: 'mcp-synthetic-id' }))
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'approve' }))

    expect(sendToSlackChannel).not.toHaveBeenCalled()
    expect(sendToChannel).not.toHaveBeenCalled()
    expect(updateTicketAIDraftStatus).toHaveBeenCalledWith(1, 'approved')
  })

  it('approve never sends for a circle ticket — ingest-only, reviewer copies the answer in by hand', async () => {
    getTicketById.mockResolvedValue(
      ticket({ source_platform: 'circle', source_channel_id: '9', source_thread_id: '55' })
    )
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'approve' }))

    expect(sendToSlackChannel).not.toHaveBeenCalled()
    expect(sendToChannel).not.toHaveBeenCalled()
    expect(postToDiscourseTopic).not.toHaveBeenCalled()
    // the draft status is still recorded
    expect(updateTicketAIDraftStatus).toHaveBeenCalledWith(1, 'approved')
  })
})

describe('updateAIDraftAction: edit dispatches on slack/telegram/email too (previously only github/google_chat/discord)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('edit posts the new draft to Slack', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'slack' }))
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'edit', newDraft: 'a corrected answer' }))

    expect(sendToSlackChannel).toHaveBeenCalled()
    expect(sendToSlackChannel.mock.calls[0][1]).toContain('a corrected answer')
  })

  it('edit posts the new draft to Telegram', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'telegram', source_channel_id: '-100123' }))
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'edit', newDraft: 'a corrected answer' }))

    expect(sendToTelegramChat).toHaveBeenCalled()
    expect(sendToTelegramChat.mock.calls[0][1]).toContain('a corrected answer')
  })

  it('edit posts the new draft by email', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'email', source_channel_id: 'sender@example.com' }))
    const { updateAIDraftAction } = await import('@/lib/actions/tickets')

    await updateAIDraftAction(null, formData({ ticketId: '1', action: 'edit', newDraft: 'a corrected answer' }))

    expect(sendEmailReply).toHaveBeenCalled()
    expect(sendEmailReply.mock.calls[0][1]).toContain('a corrected answer')
  })
})

describe('postReplyAction: manual staff reply dispatches through the same shared module', () => {
  beforeEach(() => vi.clearAllMocks())

  it('posts a staff reply to Slack', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'slack' }))
    const { postReplyAction } = await import('@/lib/actions/tickets')

    await postReplyAction(null, formData({ ticketId: '1', staffName: 'Sarah', content: 'here is the answer' }))

    expect(sendToSlackChannel).toHaveBeenCalled()
    expect(sendToSlackChannel.mock.calls[0][1]).toContain('here is the answer')
  })

  it('posts a staff reply as a GitHub issue comment', async () => {
    getTicketById.mockResolvedValue(ticket({ source_platform: 'github', source_channel_id: 'owner/repo', source_message_id: 'github-issue-42' }))
    const { postReplyAction } = await import('@/lib/actions/tickets')

    await postReplyAction(null, formData({ ticketId: '1', staffName: 'Sarah', content: 'here is the answer' }))

    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'repo', issue_number: 42, body: expect.stringContaining('here is the answer') })
    )
  })
})
