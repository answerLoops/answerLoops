import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Status changes and replies are credited to the signed-in person. The forms
 * no longer ask who is typing, so the name comes from the session; an explicit
 * name (an API caller) still wins, and an unnamed account falls back to a
 * generic label rather than failing.
 */

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  getTicketById: vi.fn(),
  addTicketReply: vi.fn(),
  updateTicketStatus: vi.fn(),
  sendTicketResolvedEmail: vi.fn(async () => {}),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ orgId: 3, user: { id: '1' } })) }))
vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketById: h.getTicketById,
  addTicketReply: h.addTicketReply,
  updateTicketStatus: h.updateTicketStatus,
  recordAnswerLoopsReply: vi.fn(),
  updateTicketAIDraftStatus: vi.fn(),
}))
vi.mock('@/lib/email/send', () => ({ sendTicketResolvedEmail: h.sendTicketResolvedEmail }))
vi.mock('@/lib/channels/post-reply', () => ({
  postReply: vi.fn(async () => 'msg-1'),
  postReplyToGithub: vi.fn(async () => 'gh-1'),
}))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const form = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 3, userId: 1, role: 'admin', userName: 'Sarah Lee' })
  h.getTicketById.mockResolvedValue({ id: 1, source_platform: 'slack', source_channel_id: 'C1', org_id: 3 })
})

describe('postReplyAction', () => {
  it('credits the reply to the signed-in person when no name is sent', async () => {
    const { postReplyAction } = await import('@/lib/actions/tickets')
    expect(await postReplyAction(null, form({ ticketId: '1', content: 'here you go' }))).toBeNull()
    expect(h.addTicketReply).toHaveBeenCalledWith(1, 'Sarah Lee', 'here you go', 'msg-1')
  })

  it('treats a blank name as no name', async () => {
    const { postReplyAction } = await import('@/lib/actions/tickets')
    await postReplyAction(null, form({ ticketId: '1', staffName: '   ', content: 'here you go' }))
    expect(h.addTicketReply.mock.calls[0][1]).toBe('Sarah Lee')
  })

  it('lets an explicit name win', async () => {
    const { postReplyAction } = await import('@/lib/actions/tickets')
    await postReplyAction(null, form({ ticketId: '1', staffName: 'Dev', content: 'here you go' }))
    expect(h.addTicketReply.mock.calls[0][1]).toBe('Dev')
  })

  it('falls back to a generic label for an account with no name', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 3, userId: 1, role: 'admin', userName: null })
    const { postReplyAction } = await import('@/lib/actions/tickets')
    await postReplyAction(null, form({ ticketId: '1', content: 'here you go' }))
    expect(h.addTicketReply.mock.calls[0][1]).toBe('Support team')
  })

  it('still needs a reply body', async () => {
    const { postReplyAction } = await import('@/lib/actions/tickets')
    expect(await postReplyAction(null, form({ ticketId: '1' }))).toEqual({ error: 'Invalid input' })
    expect(h.addTicketReply).not.toHaveBeenCalled()
  })
})

describe('updateTicketStatusAction', () => {
  it('credits the status change to the signed-in person when no name is sent', async () => {
    const { updateTicketStatusAction } = await import('@/lib/actions/tickets')
    expect(await updateTicketStatusAction(null, form({ ticketId: '1', status: 'in_progress' }))).toBeNull()
    expect(h.updateTicketStatus).toHaveBeenCalledWith(1, 'in_progress', 'Sarah Lee', undefined)
  })

  it('passes the signed-in name to the resolved email too', async () => {
    h.getTicketById.mockResolvedValue({ id: 1, source_platform: 'email', org_id: 3 })
    const { updateTicketStatusAction } = await import('@/lib/actions/tickets')
    await updateTicketStatusAction(null, form({ ticketId: '1', status: 'resolved' }))
    expect(h.sendTicketResolvedEmail).toHaveBeenCalledWith(expect.anything(), 'Sarah Lee', 3)
  })

  it('refuses a caller without org access before changing anything', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const { updateTicketStatusAction } = await import('@/lib/actions/tickets')
    expect(await updateTicketStatusAction(null, form({ ticketId: '1', status: 'open' }))).toEqual({ error: 'Unauthorized' })
    expect(h.updateTicketStatus).not.toHaveBeenCalled()
  })
})
