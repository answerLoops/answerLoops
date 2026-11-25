import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Who is emailed about website chat leads and when. The database and the mail
 * provider are faked; what is checked is the decision logic: new versus waiting
 * leads, the per-workspace window, the recipient rule, and that a problem
 * sending never marks leads as sent or escapes to the caller.
 */

const h = vi.hoisted(() => ({
  emailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(async () => true),
  listPending: vi.fn(),
  claim: vi.fn(async () => true),
  mark: vi.fn(async () => {}),
  orgsWithPending: vi.fn(async () => [] as number[]),
  members: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/email/widget-lead', () => ({
  emailServiceConfigured: h.emailConfigured,
  sendWidgetLeadEmail: h.sendEmail,
  leadsPageUrl: () => 'https://app.example.test/leads',
}))
vi.mock('@/lib/db/queries/widget-leads', () => ({
  listPendingWidgetLeads: h.listPending,
  claimWidgetLeadEmailWindow: h.claim,
  markWidgetLeadsNotified: h.mark,
  listOrgsWithPendingWidgetLeads: h.orgsWithPending,
}))
vi.mock('@/lib/db/queries/members', () => ({ getOrgMembers: h.members }))
vi.mock('@/lib/logger', () => ({ logger: h.log }))

import {
  LEAD_EMAIL_MAX_LISTED,
  LEAD_EMAIL_WINDOW_MINUTES,
  notifyNewWidgetLead,
  runWidgetLeadDigests,
  sendPendingLeadEmail,
} from '@/lib/widget/lead-notifications'

const lead = (id: number, email = `v${id}@example.test`, question: string | null = null) => ({
  id,
  email,
  question,
  createdAt: '2026-11-21T10:00:00Z',
})

const member = (role: string, email: string | null) => ({
  membership_id: 1,
  user_id: 1,
  org_id: 7,
  role,
  joined_at: '',
  email,
  name: null,
  image: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.emailConfigured.mockReturnValue(true)
  h.sendEmail.mockResolvedValue(true)
  h.claim.mockResolvedValue(true)
  h.listPending.mockResolvedValue({ leads: [lead(1, 'visitor@example.test', 'Do you ship?')], total: 1, maxId: 1 })
  h.members.mockResolvedValue([member('owner', 'owner@example.test')])
  h.orgsWithPending.mockResolvedValue([])
})

describe('sendPendingLeadEmail', () => {
  it('emails the owner about a new lead and then marks it as sent', async () => {
    expect(await sendPendingLeadEmail(7)).toBe('sent')
    expect(h.claim).toHaveBeenCalledWith(7, LEAD_EMAIL_WINDOW_MINUTES)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    const [to, input] = h.sendEmail.mock.calls[0] as unknown as [string[], { leads: unknown[]; moreCount: number; leadsUrl: string }]
    expect(to).toEqual(['owner@example.test'])
    expect(input.leads).toEqual([{ email: 'visitor@example.test', question: 'Do you ship?' }])
    expect(input.moreCount).toBe(0)
    expect(input.leadsUrl).toBe('https://app.example.test/leads')
    expect(h.mark).toHaveBeenCalledWith(7, 1)
  })

  it('emails owners and admins, once each, and nobody else', async () => {
    h.members.mockResolvedValue([
      member('owner', 'owner@example.test'),
      member('admin', 'admin@example.test'),
      member('admin', 'owner@example.test'),
      member('member', 'member@example.test'),
      member('viewer', 'viewer@example.test'),
      member('admin', null),
    ])
    await sendPendingLeadEmail(7)
    const [to] = h.sendEmail.mock.calls[0] as unknown as [string[]]
    expect(to).toEqual(['owner@example.test', 'admin@example.test'])
  })

  it('does not email a workspace that was emailed inside the window, and leaves the leads waiting', async () => {
    h.claim.mockResolvedValue(false)
    expect(await sendPendingLeadEmail(7)).toBe('waiting')
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.mark).not.toHaveBeenCalled()
  })

  it('does not use up the window when there is nothing waiting', async () => {
    h.listPending.mockResolvedValue({ leads: [], total: 0, maxId: 0 })
    expect(await sendPendingLeadEmail(7)).toBe('nothing-pending')
    expect(h.claim).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('lists up to ten leads and counts the rest', async () => {
    h.listPending
      .mockResolvedValueOnce({ leads: [lead(1)], total: 14, maxId: 14 })
      .mockResolvedValueOnce({ leads: Array.from({ length: LEAD_EMAIL_MAX_LISTED }, (_, i) => lead(i + 1)), total: 14, maxId: 14 })
    await sendPendingLeadEmail(7)
    const [, input] = h.sendEmail.mock.calls[0] as unknown as [string[], { leads: unknown[]; moreCount: number }]
    expect(input.leads).toHaveLength(10)
    expect(input.moreCount).toBe(4)
    expect(h.listPending).toHaveBeenLastCalledWith(7, LEAD_EMAIL_MAX_LISTED)
    // All of them are marked, including the four that were only counted.
    expect(h.mark).toHaveBeenCalledWith(7, 14)
  })

  it('sends nothing and touches nothing when no email service is configured', async () => {
    h.emailConfigured.mockReturnValue(false)
    expect(await sendPendingLeadEmail(7)).toBe('no-email-service')
    expect(h.listPending).not.toHaveBeenCalled()
    expect(h.claim).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.log.error).not.toHaveBeenCalled()
    expect(h.log.warn).not.toHaveBeenCalled()
  })

  it('leaves the leads waiting when the provider refuses the send', async () => {
    h.sendEmail.mockResolvedValue(false)
    expect(await sendPendingLeadEmail(7)).toBe('failed')
    expect(h.mark).not.toHaveBeenCalled()
  })

  it('leaves the leads waiting when the workspace has no owner or admin address', async () => {
    h.members.mockResolvedValue([member('member', 'member@example.test'), member('owner', null)])
    expect(await sendPendingLeadEmail(7)).toBe('no-recipients')
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.mark).not.toHaveBeenCalled()
  })
})

describe('notifyNewWidgetLead', () => {
  it('never throws, so a problem emailing the team cannot affect the visitor', async () => {
    h.listPending.mockRejectedValue(new Error('database unavailable'))
    await expect(notifyNewWidgetLead(7)).resolves.toBeUndefined()
    expect(h.log.error).toHaveBeenCalled()
  })

  it('sends for a new lead', async () => {
    await notifyNewWidgetLead(7)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('runWidgetLeadDigests', () => {
  it('sends the grouped email for each workspace whose window has closed', async () => {
    h.orgsWithPending.mockResolvedValue([7, 8])
    h.sendEmail.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const result = await runWidgetLeadDigests()
    expect(result).toEqual({ considered: 2, sent: 1, failed: 1 })
    expect(h.orgsWithPending).toHaveBeenCalledWith(LEAD_EMAIL_WINDOW_MINUTES, expect.any(Number))
  })

  it('keeps going when one workspace throws', async () => {
    h.orgsWithPending.mockResolvedValue([7, 8])
    h.listPending.mockRejectedValueOnce(new Error('boom'))
    const result = await runWidgetLeadDigests()
    expect(result.considered).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.sent).toBe(1)
  })

  it('does nothing without a mail service', async () => {
    h.emailConfigured.mockReturnValue(false)
    expect(await runWidgetLeadDigests()).toEqual({ considered: 0, sent: 0, failed: 0 })
    expect(h.orgsWithPending).not.toHaveBeenCalled()
  })
})
