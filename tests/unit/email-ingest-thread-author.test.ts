import { describe, it, expect, vi, beforeEach } from 'vitest'

// An emailed reply is stored in the ticket's thread under the sender's display
// name, tagged with the canonical (angle-bracketed) Message-ID so a redelivered
// email is idempotent. The older email tests only assert the shape loosely.

const h = vi.hoisted(() => ({
  recordCustomerReply: vi.fn(),
  getTicketById: vi.fn(),
  findTicketByMessageIds: vi.fn(),
  notifyTicketActivity: vi.fn(),
  setEmailMessageTicket: vi.fn(),
  updateEmailMessageStatus: vi.fn(),
  processCommunityMessage: vi.fn(async () => ({ ticket_id: 500 })),
}))

vi.mock('@/lib/db/queries/integrations', () => ({
  getIntegrationByBotSecret: vi.fn(async () => ({ org_id: 3, platform: 'email', enabled: 1 })),
  getIntegration: vi.fn(),
  parseChannelIds: () => [],
}))
vi.mock('@/lib/db/queries/email-domains', () => ({ getEmailDomainByDomain: vi.fn() }))
vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: h.processCommunityMessage }))
vi.mock('@/lib/db/queries/tickets', () => ({
  recordCustomerReply: h.recordCustomerReply,
  getTicketById: h.getTicketById,
  updateTicketAIDraftStatus: vi.fn(),
}))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/tickets/notify-activity', () => ({ notifyTicketActivity: h.notifyTicketActivity }))
vi.mock('@/lib/db/queries/email-messages', () => ({
  recordInboundEmail: vi.fn(async () => ({ id: 1 })),
  updateEmailMessageStatus: h.updateEmailMessageStatus,
  setEmailMessageTicket: h.setEmailMessageTicket,
  findTicketByMessageIds: h.findTicketByMessageIds,
  countRecentOutboundToSender: vi.fn(async () => 0),
  markStatusByProviderMessageId: vi.fn(),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))

function inbound(from: string, messageId: string) {
  return new Request('http://localhost/api/email/ingest', {
    method: 'POST',
    headers: { 'x-email-webhook-secret': 'org-secret', 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: 'support@acme.test',
      subject: 'Re: my login problem',
      text: 'Thanks, that fixed part of it but I still see an error.',
      headers: {
        'message-id': messageId,
        'in-reply-to': '<orig@acme.test>',
        'authentication-results': 'mx.acme.test; spf=pass; dkim=pass; dmarc=pass',
      },
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.recordCustomerReply.mockResolvedValue(true)
  h.findTicketByMessageIds.mockResolvedValue(77)
  h.getTicketById.mockResolvedValue({ id: 77, org_ticket_number: 12, source_author_id: 'customer@example.com' })
})

describe('email reply stored in the ticket thread', () => {
  it('passes the sender display name and the angle-bracketed Message-ID', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Casey Customer <customer@example.com>', '<reply-1@mail.test>') as never)
    expect(h.recordCustomerReply).toHaveBeenCalledWith(77, expect.any(String), {
      authorName: 'Casey Customer',
      messageId: '<reply-1@mail.test>',
    })
  })

  it('canonicalises a bare Message-ID so the same email always maps to one stored id', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Casey Customer <customer@example.com>', 'reply-2@mail.test') as never)
    expect(h.recordCustomerReply.mock.calls[0][2].messageId).toBe('<reply-2@mail.test>')
  })

  it('sends a push only after the reply and its bell notification have been stored', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Casey Customer <customer@example.com>', '<reply-new@mail.test>') as never)
    expect(h.notifyTicketActivity).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ticket: expect.objectContaining({ id: 77 }),
      orgId: 3,
    }))
    h.recordCustomerReply.mockResolvedValueOnce(false)
    const response = await POST(inbound('Casey Customer <customer@example.com>', '<reply-duplicate@mail.test>') as never)
    expect(h.notifyTicketActivity).toHaveBeenCalledOnce()
    expect(h.setEmailMessageTicket.mock.calls).toEqual([[1, 77], [1, 77]])
    expect(h.updateEmailMessageStatus.mock.calls).toEqual([[1, 'processed'], [1, 'processed']])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('links the email to a new ticket when deletion wins the reply race', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    h.recordCustomerReply.mockResolvedValueOnce(null)
    const response = await POST(inbound('Casey Customer <customer@example.com>', '<reply-after-delete@mail.test>') as never)
    expect(response.ok).toBe(true)
    expect(h.processCommunityMessage).toHaveBeenCalledOnce()
    expect(h.setEmailMessageTicket).toHaveBeenCalledExactlyOnceWith(1, 500)
    expect(h.notifyTicketActivity).not.toHaveBeenCalled()
  })
})
