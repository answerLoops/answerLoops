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
  updateTicketAIDraftStatus: vi.fn(),
}))

vi.mock('@/lib/db/queries/integrations', () => ({
  getIntegrationByBotSecret: h.getIntegrationByBotSecret,
  getIntegration: vi.fn(),
  parseChannelIds: () => [],
}))
vi.mock('@/lib/db/queries/email-domains', () => ({ getEmailDomainByDomain: vi.fn() }))
vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: h.processCommunityMessage }))
vi.mock('@/lib/db/queries/tickets', () => ({
  recordCustomerReply: h.recordCustomerReply,
  getTicketById: h.getTicketById,
  updateTicketAIDraftStatus: h.updateTicketAIDraftStatus,
}))
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
      headers: {
        'message-id': '<reply-1@mail.test>',
        'in-reply-to': '<orig@acme.test>',
        'authentication-results': 'mx.acme.test; spf=pass; dkim=pass; dmarc=pass',
      },
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

describe('email ingest — sender verification', () => {
  const unverified = { headers: { 'message-id': '<reply-2@mail.test>', 'in-reply-to': '<orig@acme.test>' } }

  beforeEach(() => {
    vi.clearAllMocks()
    h.getIntegrationByBotSecret.mockResolvedValue({ org_id: 3, platform: 'email', enabled: 1 })
    h.findTicketByMessageIds.mockResolvedValue(77)
    h.getTicketById.mockResolvedValue({ id: 77, org_ticket_number: 12, source_author_id: 'customer@example.com' })
    h.recordInboundEmail.mockResolvedValue({ id: 1 })
    h.processCommunityMessage.mockResolvedValue({ ticket_id: 500 })
  })

  it('does not append to an existing thread when the provider reports no passing sender check', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Customer <customer@example.com>', unverified) as never)
    expect(h.recordCustomerReply).not.toHaveBeenCalled()
    expect(h.processCommunityMessage).toHaveBeenCalled()
  })

  it('holds a new ticket for a person and raises a notification when the sender is not verified', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Customer <customer@example.com>', unverified) as never)
    expect(h.updateTicketAIDraftStatus).toHaveBeenCalledWith(500, 'needs_human', undefined, 'unverified_sender')
    expect(h.createNotification).toHaveBeenCalledWith('new_question', expect.stringContaining('customer@example.com'), 500, 3)
  })

  it('treats a failing DMARC result as unverified even when SPF passes', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Customer <customer@example.com>', {
      headers: { ...unverified.headers, 'authentication-results': 'mx; spf=pass; dkim=pass; dmarc=fail' },
    }) as never)
    expect(h.recordCustomerReply).not.toHaveBeenCalled()
    expect(h.updateTicketAIDraftStatus).toHaveBeenCalledWith(500, 'needs_human', undefined, 'unverified_sender')
  })

  it('accepts provider payload fields as the sender check when no header is present', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Customer <customer@example.com>', { ...unverified, spf: 'pass', dkim: '{@example.com : pass}' }) as never)
    expect(h.recordCustomerReply).toHaveBeenCalledWith(77, expect.any(String))
    expect(h.updateTicketAIDraftStatus).not.toHaveBeenCalled()
  })

  it('does not hold a new conversation from a verified sender', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Someone Else <other@elsewhere.test>') as never)
    expect(h.processCommunityMessage).toHaveBeenCalled()
    expect(h.updateTicketAIDraftStatus).not.toHaveBeenCalled()
  })

  it('clamps the body appended to an existing ticket', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Customer <customer@example.com>', { text: 'y'.repeat(50_000) }) as never)
    const body = (h.recordCustomerReply.mock.calls as unknown as [number, string][])[0][1]
    expect(body.length).toBe(8000)
  })

  it('stores a bounded copy of the payload', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound('Customer <customer@example.com>', { text: 'z'.repeat(1_500_000), extra: 'q'.repeat(10_000) }) as never)
    const stored = (h.recordInboundEmail.mock.calls as unknown as [{ rawPayload: unknown }][])[0][0].rawPayload
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(64 * 1024)
    expect(stored).not.toHaveProperty('extra')
  })
})
