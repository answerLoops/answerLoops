import { describe, it, expect, vi, beforeEach } from 'vitest'

// Route-level matrix for the inbound sender check: which combinations of
// provider results let a reply join an existing ticket, and what an
// unverified message triggers. A reply only joins the thread when verified;
// otherwise the new ticket is held for a person (no drafted or sent answer).

const h = vi.hoisted(() => ({
  getIntegrationByBotSecret: vi.fn(),
  processCommunityMessage: vi.fn(),
  recordCustomerReply: vi.fn(),
  getTicketById: vi.fn(),
  createNotification: vi.fn(),
  recordInboundEmail: vi.fn(),
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

type Pairs = { name: string; value: string }[]
const base: Pairs = [
  { name: 'Message-ID', value: '<reply-9@mail.test>' },
  { name: 'In-Reply-To', value: '<orig@acme.test>' },
]
const auth = (...values: string[]): Pairs => values.map((value) => ({ name: 'Authentication-Results', value }))

function inbound(headers: Pairs, extra: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/email/ingest', {
    method: 'POST',
    headers: { 'x-email-webhook-secret': 'org-secret', 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'Customer <customer@example.com>',
      to: 'support@acme.test',
      subject: 'Re: my login problem',
      text: 'Thanks, that fixed part of it but I still see an error.',
      headers,
      ...extra,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getIntegrationByBotSecret.mockResolvedValue({ org_id: 3, platform: 'email', enabled: 1 })
  h.findTicketByMessageIds.mockResolvedValue(77)
  h.getTicketById.mockResolvedValue({ id: 77, org_ticket_number: 12, source_author_id: 'customer@example.com' })
  h.recordInboundEmail.mockResolvedValue({ id: 1 })
  h.processCommunityMessage.mockResolvedValue({ ticket_id: 500 })
})

const appended = () => h.recordCustomerReply.mock.calls.length > 0

describe('inbound sender check at the route', () => {
  const verifiedCases: [string, Pairs][] = [
    ['dmarc=pass alone', [...base, ...auth('mx.acme.test; dmarc=pass')]],
    ['spf=pass with dkim=pass and no dmarc result', [...base, ...auth('mx.acme.test; spf=pass; dkim=pass')]],
    ['dmarc=pass with failing spf', [...base, ...auth('mx.acme.test; spf=fail; dkim=fail; dmarc=pass')]],
  ]
  for (const [label, headers] of verifiedCases) {
    it(`a matching sender with ${label} joins the existing ticket and is not held`, async () => {
      const { POST } = await import('@/app/api/email/ingest/route')
      await POST(inbound(headers) as never)
      expect(h.recordCustomerReply).toHaveBeenCalledWith(77, expect.any(String))
      expect(h.processCommunityMessage).not.toHaveBeenCalled()
      expect(h.updateTicketAIDraftStatus).not.toHaveBeenCalled()
    })
  }

  const unverifiedCases: [string, Pairs][] = [
    ['no check results', base],
    ['dmarc=fail with spf and dkim passing', [...base, ...auth('mx; spf=pass; dkim=pass; dmarc=fail')]],
    ['spf passing but dkim failing and no dmarc', [...base, ...auth('mx; spf=pass; dkim=fail')]],
    ['spf=pass alone', [...base, ...auth('mx; spf=pass')]],
    ['dmarc=none', [...base, ...auth('mx; dmarc=none')]],
  ]
  for (const [label, headers] of unverifiedCases) {
    it(`a matching sender with ${label} never joins the ticket; the new ticket is held for a person`, async () => {
      const { POST } = await import('@/app/api/email/ingest/route')
      await POST(inbound(headers) as never)
      expect(appended()).toBe(false)
      expect(h.updateTicketAIDraftStatus).toHaveBeenCalledWith(500, 'needs_human', undefined, 'unverified_sender')
      expect(h.createNotification).toHaveBeenCalledWith('new_question', expect.stringContaining('waiting for review'), 500, 3)
      expect(h.createNotification).not.toHaveBeenCalledWith('new_question', expect.stringContaining('replied to ticket'), expect.anything(), expect.anything())
    })
  }

  it('only the first Authentication-Results header counts: a failing first header is not overridden by a later passing one', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound([...base, ...auth('mx.acme.test; dmarc=fail', 'forwarded.test; dmarc=pass; spf=pass; dkim=pass')]) as never)
    expect(appended()).toBe(false)
    expect(h.updateTicketAIDraftStatus).toHaveBeenCalledWith(500, 'needs_human', undefined, 'unverified_sender')
  })

  it('only the first Authentication-Results header counts: a passing first header is not overridden by a later failing one', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound([...base, ...auth('mx.acme.test; dmarc=pass', 'forwarded.test; dmarc=fail')]) as never)
    expect(appended()).toBe(true)
    expect(h.updateTicketAIDraftStatus).not.toHaveBeenCalled()
  })

  it('a payload-level dmarc=fail wins over passing spf and dkim fields', async () => {
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound(base, { spf: 'pass', dkim: 'pass', dmarc: 'fail' }) as never)
    expect(appended()).toBe(false)
    expect(h.updateTicketAIDraftStatus).toHaveBeenCalledWith(500, 'needs_human', undefined, 'unverified_sender')
  })

  describe('provider payload shapes', () => {
    const ar = 'mx.acme.test; spf=pass; dkim=pass; dmarc=pass'
    const arFail = 'mx.acme.test; spf=pass; dkim=pass; dmarc=fail'
    const rawBlock = (v: string) =>
      `Message-ID: <reply-9@mail.test>\nIn-Reply-To: <orig@acme.test>\nAuthentication-Results: ${v.replace('; ', ';\n\t')}\n`
    const post = async (payload: Record<string, unknown>) => {
      const { POST } = await import('@/app/api/email/ingest/route')
      const req = new Request('http://localhost/api/email/ingest', {
        method: 'POST',
        headers: { 'x-email-webhook-secret': 'org-secret', 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'customer@example.com', to: 'support@acme.test', subject: 'Re: my login problem', text: 'Thanks, I still see an error on login.', ...payload }),
      })
      await POST(req as never)
    }
    const shapes: [string, (v: string) => Record<string, unknown>][] = [
      ['SendGrid raw header block with folded lines', (v) => ({ headers: rawBlock(v) })],
      ['Postmark Headers array of Name/Value objects', (v) => ({ Headers: [
        { Name: 'Message-ID', Value: '<reply-9@mail.test>' }, { Name: 'In-Reply-To', Value: '<orig@acme.test>' }, { Name: 'Authentication-Results', Value: v }] })],
      ['Mailgun message-headers JSON string of pairs', (v) => ({ 'message-headers': JSON.stringify([
        ['Message-Id', '<reply-9@mail.test>'], ['In-Reply-To', '<orig@acme.test>'], ['Authentication-Results', v]]) })],
      ['Mailgun message-headers array of pairs', (v) => ({ 'message-headers': [
        ['Message-Id', '<reply-9@mail.test>'], ['In-Reply-To', '<orig@acme.test>'], ['Authentication-Results', v]] })],
    ]
    for (const [label, build] of shapes) {
      it(`${label}: a passing result lets the reply join the ticket`, async () => {
        await post(build(ar))
        expect(h.recordCustomerReply).toHaveBeenCalledWith(77, expect.any(String))
        expect(h.updateTicketAIDraftStatus).not.toHaveBeenCalled()
      })
      it(`${label}: a failing result holds the new ticket for a person`, async () => {
        await post(build(arFail))
        expect(appended()).toBe(false)
        expect(h.updateTicketAIDraftStatus).toHaveBeenCalledWith(500, 'needs_human', undefined, 'unverified_sender')
      })
    }
  })

  it('a verified sender who does not own the ticket is still handled as a separate, unheld conversation', async () => {
    h.getTicketById.mockResolvedValue({ id: 77, org_ticket_number: 12, source_author_id: 'someone-else@example.com' })
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound([...base, ...auth('mx; dmarc=pass')]) as never)
    expect(appended()).toBe(false)
    expect(h.processCommunityMessage).toHaveBeenCalled()
    expect(h.updateTicketAIDraftStatus).not.toHaveBeenCalled()
  })

  it('does not hold a message the pipeline reports as a duplicate', async () => {
    h.processCommunityMessage.mockResolvedValue({ ticket_id: 500, duplicate: true })
    const { POST } = await import('@/app/api/email/ingest/route')
    await POST(inbound(base) as never)
    expect(h.updateTicketAIDraftStatus).not.toHaveBeenCalled()
  })
})
