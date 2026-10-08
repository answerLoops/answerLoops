import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The feedback alert runs inside a user's submit action, so the property that
 * matters most is that it cannot fail the submission. These tests call the real
 * function against a mocked provider.
 */

const send = vi.fn()

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))
vi.mock('@/lib/db/queries/members', () => ({ getOrgMembers: vi.fn(async () => []) }))
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))

const ORIGINAL_KEY = process.env.RESEND_API_KEY
const ORIGINAL_TO = process.env.FEEDBACK_NOTIFY_EMAIL

async function subject() {
  return import('@/lib/email/send')
}

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ data: { id: 'email_1' }, error: null })
  process.env.RESEND_API_KEY = 'test-key'
  delete process.env.FEEDBACK_NOTIFY_EMAIL
  vi.resetModules()
})

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = ORIGINAL_KEY
  if (ORIGINAL_TO === undefined) delete process.env.FEEDBACK_NOTIFY_EMAIL
  else process.env.FEEDBACK_NOTIFY_EMAIL = ORIGINAL_TO
})

describe('sendProductFeedbackNotification', () => {
  it('sends to hello@answerloops.com by default', async () => {
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].to).toEqual(['hello@answerloops.com'])
    expect(send.mock.calls[0][0].subject).toContain('Setup was really quick')
  })

  it('uses FEEDBACK_NOTIFY_EMAIL when set', async () => {
    process.env.FEEDBACK_NOTIFY_EMAIL = 'founder@example.com'
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    expect(send.mock.calls[0][0].to).toEqual(['founder@example.com'])
  })

  it('says when feedback was posted anonymously', async () => {
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: true })
    expect(send.mock.calls[0][0].html).toContain('Posted anonymously')
    expect(send.mock.calls[0][0].text).toContain('anonymously')
  })

  it('escapes user-supplied markup in the HTML body', async () => {
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: '<script>alert(1)</script> & more text here', anonymous: false })
    const html = send.mock.calls[0][0].html as string
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp; more')
  })

  it('resolves rather than throwing when the provider rejects', async () => {
    send.mockRejectedValue(new Error('provider is down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sendProductFeedbackNotification } = await subject()
    await expect(
      sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('sends nothing when no API key is configured', async () => {
    delete process.env.RESEND_API_KEY
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    expect(send).not.toHaveBeenCalled()
  })
})
