import { describe, it, expect, vi, beforeEach } from 'vitest'

// A reply joins an existing ticket thread only when it comes from the address
// that opened that ticket; and the body cap is counted on streamed bytes.

const h = vi.hoisted(() => ({
  getIntegrationByBotSecret: vi.fn(),
  processCommunityMessage: vi.fn(async () => ({ ticket_id: 500 })),
  recordCustomerReply: vi.fn(),
  getTicketById: vi.fn(),
  createNotification: vi.fn(),
  recordInboundEmail: vi.fn(async () => ({ id: 1 })),
  findTicketByMessageIds: vi.fn(),
}))

vi.mock('@/lib/db/queries/integrations', () => ({
  getIntegrationByBotSecret: h.getIntegrationByBotSecret,
  getIntegration: vi.fn(),
  parseChannelIds: () => [],
}))
vi.mock('@/lib/db/queries/email-domains', () => ({ getEmailDomainByDomain: vi.fn() }))
vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: h.processCommunityMessage }))
vi.mock('@/lib/db/queries/tickets', () => ({ recordCustomerReply: h.recordCustomerReply, getTicketById: h.getTicketById }))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification: h.createNotification }))
vi.mock('@/lib/db/queries/email-messages', () => ({
  recordInboundEmail: h.recordInboundEmail,
  updateEmailMessageStatus: vi.fn(),
  setEmailMessageTicket: vi.fn(),
  findTicketByMessageIds: h.findTicketByMessageIds,
  countRecentOutboundToSender: vi.fn(async () => 0),
  markStatusByProviderMessageId: vi.fn(),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: vi.fn(async () => ({ ok: true })) }))

function inbound(from: string, extra: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/email/ingest', {
    method: 'POST',
    headers: { 'x-email-webhook-secret': 'org-secret', 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: 'support@acme.test',
      subject: 'Re: my login problem',
      text: 'Thanks, that fixed part of it but I still see an error.',
      headers: { 'message-id': '<reply-1@mail.test>', 'in-reply-to': '<orig@acme.test>' },
      ...extra,
    }),
  })
}

describe('email ingest — threading by sender', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getIntegrationByBotSecret.mockResolvedValue({ org_id: 3, platform: 'email', enabled: 1 })
    h.findTicketByMessageIds.mockResolvedValue(77)
    h.getTicketById.mockResolvedValue({ id: 77, org_ticket_number: 12, source_author_id: 'customer@example.com' })
    h.recordInboundEmail.mockResolvedValue({ id: 1 })
  })

  it('looks the secret up for the email platform only', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Customer <customer@example.com>') as never)
    expect(h.getIntegrationByBotSecret).toHaveBeenCalledWith('org-secret', 'email')
  })

  it('appends a reply from the address that opened the ticket', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    const res = await POST(inbound('Customer <Customer@Example.com>') as never)
    expect(res.status).toBe(200)
    expect(h.recordCustomerReply).toHaveBeenCalledWith(77, expect.any(String))
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('does not append a reply from a different sender; it becomes its own conversation', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Someone Else <other@elsewhere.test>') as never)
    expect(h.recordCustomerReply).not.toHaveBeenCalled()
    expect(h.processCommunityMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: 'other@elsewhere.test', platform: 'email' }),
      3
    )
  })

  it('rejects an oversized streamed body even when Content-Length is missing or understated', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    const big = new Request('http://localhost/api/email/ingest', {
      method: 'POST',
      headers: { 'x-email-webhook-secret': 'org-secret', 'content-type': 'application/json', 'content-length': '10' },
      body: JSON.stringify({ from: 'a@b.test', text: 'x'.repeat(2_100_000) }),
    })
    const res = await POST(big as never)
    expect(res.status).toBe(413)
    expect(h.recordInboundEmail).not.toHaveBeenCalled()
  })
})
