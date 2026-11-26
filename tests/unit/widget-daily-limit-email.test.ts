import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * sendWidgetDailyLimitEmail (lib/email/send.ts). The chat route starts it in
 * the background and does not wait, so it must never throw: a failure is
 * logged and the visitor's answer is unaffected. It goes to the workspace's
 * owners and admins only, and is skipped when email is not set up.
 */

const h = vi.hoisted(() => ({
  send: vi.fn(),
  getOrgMembers: vi.fn(),
  mock: { MOCK_EXTERNALS: false },
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.send }
  },
}))
vi.mock('@/lib/db/queries/members', () => ({ getOrgMembers: h.getOrgMembers }))
vi.mock('@/lib/mock-mode', () => h.mock)
vi.mock('@/lib/logger', () => ({ logger: h.logger }))
vi.mock('@/lib/site', () => ({ appOrigin: () => 'https://app.test' }))

const subject = async () => (await import('@/lib/email/send')).sendWidgetDailyLimitEmail

const input = { orgId: 42, orgName: 'Acme <Support>', kind: 'warning' as const, limit: 2_500 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  h.mock.MOCK_EXTERNALS = false
  vi.stubEnv('RESEND_API_KEY', '<test-resend-key>')
  vi.stubEnv('RESEND_FROM', '')
  h.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })
  h.getOrgMembers.mockResolvedValue([
    { role: 'owner', email: 'owner@acme.test' },
    { role: 'admin', email: 'admin@acme.test' },
    { role: 'member', email: 'member@acme.test' },
    { role: 'admin', email: null },
  ])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sendWidgetDailyLimitEmail', () => {
  it("sends the warning to the workspace's owners and admins only", async () => {
    await (await subject())(input)
    expect(h.getOrgMembers).toHaveBeenCalledWith(42)
    expect(h.send).toHaveBeenCalledOnce()
    const msg = h.send.mock.calls[0][0]
    expect(msg.to).toEqual(['owner@acme.test', 'admin@acme.test'])
    expect(msg.subject).toBe('Your website chat has used 80% of its daily limit')
    expect(msg.text).toContain('80% of its daily limit of 2,500 answers')
    expect(msg.text).toContain('https://app.test/settings?tab=widget')
  })

  it('sends the reached email with the limit in the subject', async () => {
    await (await subject())({ ...input, kind: 'reached' })
    const msg = h.send.mock.calls[0][0]
    expect(msg.subject).toBe('Your website chat reached its daily limit of 2,500 answers')
    expect(msg.text).toContain('answered 2,500 questions in the last day')
  })

  it("escapes the workspace's name in the message", async () => {
    await (await subject())(input)
    const msg = h.send.mock.calls[0][0]
    expect(msg.html).toContain('Acme &lt;Support&gt;')
    expect(msg.html).not.toContain('Acme <Support>')
  })

  it('sends nothing without an email key', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    await (await subject())(input)
    expect(h.getOrgMembers).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('sends nothing in mock mode', async () => {
    h.mock.MOCK_EXTERNALS = true
    await (await subject())(input)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('sends nothing when the workspace has no owner or admin with an email', async () => {
    h.getOrgMembers.mockResolvedValue([{ role: 'member', email: 'member@acme.test' }])
    await (await subject())(input)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('logs and resolves when the email service throws', async () => {
    h.send.mockRejectedValue(new Error('network down'))
    await expect((await subject())(input)).resolves.toBeUndefined()
    expect(h.logger.warn).toHaveBeenCalledWith(
      'Failed to send widget daily limit email',
      expect.objectContaining({ orgId: 42, kind: 'warning', error: 'network down' })
    )
  })

  it('logs and resolves when looking up the recipients fails', async () => {
    h.getOrgMembers.mockRejectedValue(new Error('db unavailable'))
    await expect((await subject())(input)).resolves.toBeUndefined()
    expect(h.send).not.toHaveBeenCalled()
    expect(h.logger.warn).toHaveBeenCalledWith('Failed to send widget daily limit email', expect.anything())
  })

  it('logs when the email service declines the message', async () => {
    h.send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'domain not verified' } })
    await expect((await subject())(input)).resolves.toBeUndefined()
    expect(h.logger.warn).toHaveBeenCalledWith(
      'Widget daily limit email was not accepted',
      expect.objectContaining({ orgId: 42, kind: 'warning' })
    )
  })
})
