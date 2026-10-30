import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The welcome email is sent from the sign-in path, which makes one property
 * more important than anything the message says: it cannot fail a signup.
 *
 * A provider outage turning into a failed sign-in would leave somebody holding
 * an account they cannot get into, over a courtesy email. So the send is
 * guarded, swallowed, and logged — and these tests invoke the real function
 * against a mocked provider rather than asserting on source text, because
 * "does not throw" is a behaviour and not a shape.
 */

const send = vi.fn()

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

// send.ts pulls these in at module scope; neither is exercised here.
vi.mock('@/lib/db/queries/members', () => ({ getOrgMembers: vi.fn(async () => []) }))
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))

const ORIGINAL_KEY = process.env.RESEND_API_KEY

async function subject() {
  const mod = await import('@/lib/email/send')
  return mod
}

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ data: { id: 'email_1' }, error: null })
  process.env.RESEND_API_KEY = 'test-key'
  vi.resetModules()
})

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = ORIGINAL_KEY
})

describe('sendWelcomeEmail — never breaks a signup', () => {
  it('resolves rather than throwing when the provider rejects', async () => {
    send.mockRejectedValue(new Error('provider is down'))
    const { sendWelcomeEmail } = await subject()
    await expect(sendWelcomeEmail('new@example.com', 'Ada')).resolves.toBeUndefined()
  })

  it('sends nothing when no API key is configured', async () => {
    delete process.env.RESEND_API_KEY
    const { sendWelcomeEmail } = await subject()
    await sendWelcomeEmail('new@example.com', 'Ada')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('sendWelcomeEmail — what it sends', () => {
  it('goes to the address that just signed up', async () => {
    const { sendWelcomeEmail } = await subject()
    await sendWelcomeEmail('new@example.com', 'Ada Lovelace')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].to).toEqual(['new@example.com'])
  })

  it('points at support for questions, in the body and as the reply address', async () => {
    const { sendWelcomeEmail, SUPPORT_EMAIL } = await subject()
    await sendWelcomeEmail('new@example.com', 'Ada')
    const payload = send.mock.calls[0][0]
    expect(SUPPORT_EMAIL).toBe('support@answerloops.com')
    expect(payload.replyTo).toBe(SUPPORT_EMAIL)
    expect(payload.html).toContain(SUPPORT_EMAIL)
  })

  it('thanks them by first name', async () => {
    const { sendWelcomeEmail } = await subject()
    await sendWelcomeEmail('new@example.com', 'Ada Lovelace')
    expect(send.mock.calls[0][0].html).toContain('Welcome, Ada.')
  })

  it('greets without a name rather than printing an empty one', async () => {
    const { sendWelcomeEmail } = await subject()
    for (const name of [null, '', '   ']) {
      send.mockClear()
      await sendWelcomeEmail('new@example.com', name)
      const html = send.mock.calls[0][0].html
      expect(html).toContain('Welcome.')
      expect(html).not.toMatch(/Welcome,\s*\./)
    }
  })
})

describe('the welcome email is sent to a customer, not to an account', () => {
  const read = async (rel: string) => (await import('node:fs')).readFileSync(rel, 'utf-8')

  it('is sent when a trial actually starts, not on every sign-in', async () => {
    // The trial is card-free, so starting one is the moment someone becomes a
    // customer with a dashboard to be welcomed into. It is gated on the trial
    // having started, so a person the ledger refuses is not greeted as new.
    const src = await read('lib/auth/signup.ts')
    expect(src).toContain("outcome.status !== 'started'")
    expect(src.indexOf("outcome.status !== 'started'")).toBeLessThan(src.indexOf('sendWelcomeEmail(email'))
  })

  it('is still sent from the checkout handler for an org that never had a trial row', async () => {
    const src = await read('app/api/billing/webhook/route.ts')
    const checkoutCase = src.slice(
      src.indexOf("case 'checkout.session.completed'"),
      src.indexOf("case 'customer.subscription.updated'"),
    )
    expect(checkoutCase).toContain('sendWelcomeEmail(')
  })

  it('only welcomes an org that had no subscription before this one', async () => {
    // A cancel-and-resubscribe is the same org coming back, not a new customer.
    // The check must be part of the same transaction as the upsert, otherwise
    // concurrent checkout events can both classify themselves as first.
    const src = await read('app/api/billing/webhook/route.ts')
    const checkoutCase = src.slice(
      src.indexOf("case 'checkout.session.completed'"),
      src.indexOf("case 'customer.subscription.updated'"),
    )
    const claimAt = checkoutCase.indexOf('const isFirstSubscription = await upsertSubscriptionAndClaimWelcome(')
    const guardAt = checkoutCase.indexOf('if (isFirstSubscription)')

    expect(claimAt, 'the first-subscription claim').toBeGreaterThan(-1)
    expect(guardAt, 'the send must be gated on the atomic claim').toBeGreaterThan(claimAt)
  })

  it('cannot fail the webhook when the mail provider is down', async () => {
    // A non-2xx makes Stripe retry an event whose subscription is already
    // written. The send is wrapped so a provider outage stays a logged error.
    const src = await read('app/api/billing/webhook/route.ts')
    const guarded = src.slice(src.indexOf('if (isFirstSubscription)'), src.indexOf("case 'customer.subscription.updated'"))
    expect(guarded).toContain('try {')
    expect(guarded).toContain('catch')
    expect(guarded, 'a throw here would cost a retry, not just an email').not.toMatch(/throw\s/)
  })

  it('addresses the org owner rather than whatever Stripe collected', async () => {
    // Someone may pay with a different address than they signed up with. The
    // account is the one they will sign back into.
    const src = await read('app/api/billing/webhook/route.ts')
    expect(src).toContain('getOrgOwner(orgId)')
    const line = src.slice(src.indexOf('const to = '), src.indexOf('const to = ') + 120)
    expect(line.indexOf('owner?.email'), 'owner address is preferred').toBeLessThan(
      line.indexOf('session.customer_details?.email'),
    )
  })
})
