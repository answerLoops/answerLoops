import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The feedback alert runs inside a user's submit action, so the property that
 * matters most is that it cannot fail the submission. These tests call the real
 * function against a mocked provider.
 */

const send = vi.fn()
const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))
vi.mock('@/lib/db/queries/members', () => ({ getOrgMembers: vi.fn(async () => []) }))
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))
vi.mock('@/lib/logger', () => ({ logger }))

const ORIGINAL_KEY = process.env.RESEND_API_KEY
const ORIGINAL_TO = process.env.FEEDBACK_NOTIFY_EMAIL
const ORIGINAL_FROM = process.env.RESEND_FROM

async function subject() {
  return import('@/lib/email/send')
}

beforeEach(() => {
  send.mockReset()
  logger.warn.mockReset()
  logger.error.mockReset()
  delete process.env.RESEND_FROM
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
  if (ORIGINAL_FROM === undefined) delete process.env.RESEND_FROM
  else process.env.RESEND_FROM = ORIGINAL_FROM
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

  it('resolves rather than throwing when the provider throws, and logs it', async () => {
    send.mockRejectedValue(new Error('provider is down'))
    const { sendProductFeedbackNotification } = await subject()
    await expect(
      sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      'Feedback alert failed',
      expect.objectContaining({ module: 'email', error: expect.any(Error) })
    )
  })

  it('logs a send the provider rejects with an error result instead of throwing', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'The domain is not verified' } })
    const { sendProductFeedbackNotification } = await subject()
    await expect(
      sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'Feedback alert rejected by Resend',
      expect.objectContaining({ module: 'email', resendError: 'validation_error', resendMessage: 'The domain is not verified' })
    )
  })

  it('never writes the feedback text to the logs', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } })
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: 'A very private remark about billing.', anonymous: false })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private remark')
  })

  it('does not log an error when the send succeeds', async () => {
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns and sends nothing when no API key is configured', async () => {
    delete process.env.RESEND_API_KEY
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    expect(send).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('Feedback alert skipped: RESEND_API_KEY is not set', { module: 'email' })
  })

  it('sends from RESEND_FROM when set', async () => {
    process.env.RESEND_FROM = 'alerts@example.com'
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    expect(send.mock.calls[0][0].from).toBe('alerts@example.com')
  })

  it('falls back to a real sender, not the placeholder domain, when RESEND_FROM is unset', async () => {
    const { sendProductFeedbackNotification } = await subject()
    await sendProductFeedbackNotification({ body: 'Setup was really quick for us.', anonymous: false })
    expect(send.mock.calls[0][0].from).toBe('hello@answerloops.com')
    expect(send.mock.calls[0][0].from).not.toContain('yourdomain.com')
  })
})
