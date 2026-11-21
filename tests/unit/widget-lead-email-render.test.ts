import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The email the team gets when a visitor leaves their address in the website
 * chat. Everything a visitor typed is escaped in the HTML and plain in the text
 * part, the subject carries no visitor text, and the visitor is never an
 * addressee.
 */

const h = vi.hoisted(() => ({ send: vi.fn(), ctor: vi.fn() }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.send }
    constructor(key?: string) {
      h.ctor(key)
    }
  },
}))
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  emailServiceConfigured,
  leadsPageUrl,
  renderWidgetLeadEmail,
  sendWidgetLeadEmail,
} from '@/lib/email/widget-lead'

const URL_ = 'https://app.example.test/leads'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = '<resend-api-key>'
  process.env.RESEND_FROM = 'notifications@example.test'
})
afterEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.RESEND_FROM
  delete process.env.APP_URL
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.AUTH_URL
})

describe('renderWidgetLeadEmail', () => {
  it('uses a fixed subject for one lead, with nothing the visitor typed in it', () => {
    const out = renderWidgetLeadEmail({
      leads: [{ email: 'evil+<script>@example.test', question: 'Subject: win a prize' }],
      moreCount: 0,
      leadsUrl: URL_,
    })
    expect(out.subject).toBe('New lead from your website chat')
  })

  it('puts only a count in the subject for several leads', () => {
    const out = renderWidgetLeadEmail({
      leads: [
        { email: 'a@example.test', question: null },
        { email: 'b@example.test', question: null },
      ],
      moreCount: 3,
      leadsUrl: URL_,
    })
    expect(out.subject).toBe('5 new leads from your website chat')
  })

  it('shows the address, the question and a link to the Leads page', () => {
    const out = renderWidgetLeadEmail({
      leads: [{ email: 'visitor@example.test', question: 'Do you ship to Canada?' }],
      moreCount: 0,
      leadsUrl: URL_,
    })
    expect(out.html).toContain('visitor@example.test')
    expect(out.html).toContain('Do you ship to Canada?')
    expect(out.html).toContain(`href="${URL_}"`)
    expect(out.text).toContain('visitor@example.test')
    expect(out.text).toContain('Question the chat could not answer: Do you ship to Canada?')
    expect(out.text).toContain(`Open your leads: ${URL_}`)
  })

  it('says so when the visitor left their address before asking anything', () => {
    const out = renderWidgetLeadEmail({ leads: [{ email: 'a@example.test', question: null }], moreCount: 0, leadsUrl: URL_ })
    expect(out.html).toContain('Left their email before asking a question.')
    expect(out.html).not.toContain('could not answer')
    expect(out.text).toContain('Left their email before asking a question.')
  })

  it('escapes visitor text in the HTML so it can never become markup', () => {
    const out = renderWidgetLeadEmail({
      leads: [{ email: '"><img src=x onerror=alert(1)>@example.test', question: '<script>alert(1)</script> & <b>bold</b>' }],
      moreCount: 0,
      leadsUrl: URL_,
    })
    expect(out.html).not.toContain('<script>')
    expect(out.html).not.toContain('<img')
    expect(out.html).not.toContain('<b>bold</b>')
    expect(out.html).toContain('&lt;script&gt;')
    expect(out.html).toContain('&amp;')
  })

  it('keeps visitor text as typed in the plain-text part, with no markup added', () => {
    const out = renderWidgetLeadEmail({
      leads: [{ email: 'a@example.test', question: 'Is <b>this</b> & that ok?' }],
      moreCount: 0,
      leadsUrl: URL_,
    })
    expect(out.text).toContain('Is <b>this</b> & that ok?')
    expect(out.text).not.toContain('&lt;')
  })

  it('cuts a very long question and flattens its line breaks', () => {
    const out = renderWidgetLeadEmail({
      leads: [{ email: 'a@example.test', question: `line one\n\nline two ${'x'.repeat(2000)}` }],
      moreCount: 0,
      leadsUrl: URL_,
    })
    expect(out.html).toContain('line one line two')
    expect(out.html.length).toBeLessThan(4000)
    expect(out.text).toContain('…')
    expect(out.text.split('\n').some((l) => l.includes('line one line two'))).toBe(true)
  })

  it('counts the leads it does not list and points to the Leads page', () => {
    const out = renderWidgetLeadEmail({
      leads: Array.from({ length: 10 }, (_, i) => ({ email: `v${i}@example.test`, question: null })),
      moreCount: 7,
      leadsUrl: URL_,
    })
    expect(out.html).toContain('+7 more on your Leads page.')
    expect(out.text).toContain('+7 more on your Leads page.')
    expect(out.subject).toBe('17 new leads from your website chat')
  })

  it('is a single narrow column, readable on a phone', () => {
    const out = renderWidgetLeadEmail({ leads: [{ email: 'a@example.test', question: null }], moreCount: 0, leadsUrl: URL_ })
    expect(out.html).toContain('max-width:480px')
    expect(out.html).not.toMatch(/<table/i)
  })
})

describe('leadsPageUrl', () => {
  it('uses the app address when one is set', () => {
    process.env.APP_URL = 'https://app.example.test/'
    expect(leadsPageUrl()).toBe('https://app.example.test/leads')
  })
  it('falls back to the sign-in address', () => {
    process.env.AUTH_URL = 'https://auth.example.test/'
    expect(leadsPageUrl()).toBe('https://auth.example.test/leads')
  })
})

describe('sendWidgetLeadEmail', () => {
  const input = { leads: [{ email: 'visitor@example.test', question: 'Hi?' }], moreCount: 0, leadsUrl: URL_ }

  it('sends to the team only, with no Reply-To and the visitor nowhere in the recipients', async () => {
    h.send.mockResolvedValue({ data: { id: '1' }, error: null })
    const ok = await sendWidgetLeadEmail(['owner@example.test', 'admin@example.test'], input)
    expect(ok).toBe(true)
    expect(h.send).toHaveBeenCalledTimes(1)
    const arg = h.send.mock.calls[0][0]
    expect(arg.to).toEqual(['owner@example.test', 'admin@example.test'])
    expect(arg.to).not.toContain('visitor@example.test')
    expect(arg).not.toHaveProperty('replyTo')
    expect(arg).not.toHaveProperty('reply_to')
    expect(arg).not.toHaveProperty('cc')
    expect(arg).not.toHaveProperty('bcc')
    expect(arg.from).toBe('notifications@example.test')
    expect(arg.subject).toBe('New lead from your website chat')
    expect(typeof arg.html).toBe('string')
    expect(typeof arg.text).toBe('string')
  })

  it('does nothing and returns false when no mail service is configured', async () => {
    delete process.env.RESEND_API_KEY
    expect(emailServiceConfigured()).toBe(false)
    expect(await sendWidgetLeadEmail(['owner@example.test'], input)).toBe(false)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('does nothing when there is nobody to send to', async () => {
    expect(await sendWidgetLeadEmail([], input)).toBe(false)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('returns false instead of throwing when the provider throws', async () => {
    h.send.mockRejectedValue(new Error('network down'))
    await expect(sendWidgetLeadEmail(['owner@example.test'], input)).resolves.toBe(false)
  })

  it('returns false when the provider answers with an error', async () => {
    h.send.mockResolvedValue({ data: null, error: { message: 'bad request' } })
    await expect(sendWidgetLeadEmail(['owner@example.test'], input)).resolves.toBe(false)
  })
})


describe('the visitor-text note and odd addresses', () => {
  const lead = (email: string, question: string | null = null) => ({ email, question })

  it('says in both parts that what the visitor typed has not been verified', () => {
    const { html, text } = renderWidgetLeadEmail({ leads: [lead('visitor@example.com', 'Do you ship?')], moreCount: 0, leadsUrl: URL_ })
    expect(html).toContain('typed by the visitor and have not been verified')
    expect(text).toContain('typed by the visitor and have not been verified')
    expect(text).toContain('Treat any links or requests in them with care.')
  })

  it('shows the note once per email, however many leads it lists', () => {
    const { html, text } = renderWidgetLeadEmail({
      leads: [lead('a@example.com'), lead('b@example.com'), lead('c@example.com')],
      moreCount: 4,
      leadsUrl: URL_,
    })
    expect(html.match(/have not been verified/g)).toHaveLength(1)
    expect(text.match(/have not been verified/g)).toHaveLength(1)
  })

  it('never prints an address that fails the check, in either part, and says why', () => {
    const odd = 'evil.com/x@example.com'
    const { html, text } = renderWidgetLeadEmail({ leads: [lead(odd)], moreCount: 0, leadsUrl: URL_ })
    expect(html).not.toContain(odd)
    expect(text).not.toContain(odd)
    expect(html).toContain('address not shown')
    expect(text).toContain('address not shown')
  })

  it('still prints a normal address next to an omitted one', () => {
    const { text } = renderWidgetLeadEmail({
      leads: [lead('Name <x@example.com>'), lead('good@example.com')],
      moreCount: 0,
      leadsUrl: URL_,
    })
    expect(text).toContain('good@example.com')
    expect(text).not.toContain('Name <x@example.com>')
  })
})
