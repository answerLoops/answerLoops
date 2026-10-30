import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Who gets a trial-ending email, when, and exactly once. The database and the
// mail provider are faked; the claim/release SQL is exercised against a real
// Postgres separately.

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-10T12:00:00Z')

const h = vi.hoisted(() => ({
  candidates: [] as Record<string, unknown>[],
  claimResult: [{ id: 1 }] as unknown[],
  statements: [] as string[],
  owner: { email: 'owner@acme.io', name: 'Pat Lee' } as { email: string | null; name: string | null } | null,
  send: vi.fn(),
}))

vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({
    execute: async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q)
      h.statements.push(text)
      if (text.includes('RETURNING id')) return h.claimResult
      if (text.includes('FROM subscriptions s')) return h.candidates
      return []
    },
  }),
}))
vi.mock('@/lib/db/queries/members', () => ({ getOrgOwner: async () => h.owner }))
vi.mock('@/lib/email/send', () => ({ sendTrialEndingEmail: h.send }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { dueReminder, checkoutUrlFor, runTrialReminders } from '@/lib/billing/trial-reminders'

const row = (leftMs: number, sent = { s3: false, s1: false }) => ({
  id: 1,
  org_id: 9,
  trial_ends_at: new Date(NOW.getTime() + leftMs).toISOString(),
  sent_3d: sent.s3,
  sent_1d: sent.s1,
})

beforeEach(() => {
  h.candidates = []
  h.claimResult = [{ id: 1 }]
  h.statements = []
  h.owner = { email: 'owner@acme.io', name: 'Pat Lee' }
  h.send.mockReset().mockResolvedValue(true)
})

describe('dueReminder', () => {
  const none = { threeDay: false, oneDay: false }
  it('is quiet until three days are left and after the trial ends', () => {
    expect(dueReminder(NOW.getTime() + 3 * DAY + 1000, none, NOW.getTime())).toBeNull()
    expect(dueReminder(NOW.getTime(), none, NOW.getTime())).toBeNull()
    expect(dueReminder(NOW.getTime() - DAY, none, NOW.getTime())).toBeNull()
  })

  it('sends the three-day notice from three days out, once', () => {
    expect(dueReminder(NOW.getTime() + 2.5 * DAY, none, NOW.getTime())).toBe('3d')
    expect(dueReminder(NOW.getTime() + 2.5 * DAY, { threeDay: true, oneDay: false }, NOW.getTime())).toBeNull()
  })

  it('sends the one-day notice within the last day, once', () => {
    expect(dueReminder(NOW.getTime() + 0.5 * DAY, { threeDay: true, oneDay: false }, NOW.getTime())).toBe('1d')
    expect(dueReminder(NOW.getTime() + 0.5 * DAY, { threeDay: true, oneDay: true }, NOW.getTime())).toBeNull()
  })

  it('after an outage sends the notice that is true now, not a stale three-day one', () => {
    expect(dueReminder(NOW.getTime() + 0.5 * DAY, none, NOW.getTime())).toBe('1d')
  })
})

describe('checkoutUrlFor', () => {
  it('goes straight to checkout and tags the campaign', () => {
    vi.stubEnv('APP_URL', 'https://app.answerloops.com')
    const url = new URL(checkoutUrlFor('1d'))
    expect(url.origin).toBe('https://app.answerloops.com')
    expect(url.pathname).toBe('/checkout')
    expect(url.searchParams.get('utm_campaign')).toBe('trial_ending_1d')
    vi.unstubAllEnvs()
  })
})

describe('runTrialReminders', () => {
  it('emails the owner the three-day notice with a checkout link', async () => {
    h.candidates = [row(2.5 * DAY)]
    const out = await runTrialReminders(NOW)
    expect(out).toEqual({ considered: 1, sent: 1, failed: 0 })
    expect(h.send).toHaveBeenCalledWith(
      'owner@acme.io',
      'Pat Lee',
      expect.objectContaining({ kind: '3d', checkoutUrl: expect.stringContaining('/checkout?') }),
    )
  })

  it('sends the one-day notice for a trial in its last day', async () => {
    h.candidates = [row(0.4 * DAY, { s3: true, s1: false })]
    await runTrialReminders(NOW)
    expect(h.send).toHaveBeenCalledWith('owner@acme.io', 'Pat Lee', expect.objectContaining({ kind: '1d' }))
  })

  it('does not send a notice another sweep already claimed', async () => {
    h.candidates = [row(2.5 * DAY)]
    h.claimResult = []
    const out = await runTrialReminders(NOW)
    expect(h.send).not.toHaveBeenCalled()
    expect(out.sent).toBe(0)
  })

  it('puts a notice back when the mail provider fails, so the next sweep retries', async () => {
    h.candidates = [row(2.5 * DAY)]
    h.send.mockResolvedValue(false)
    const out = await runTrialReminders(NOW)
    expect(out).toMatchObject({ sent: 0, failed: 1 })
    expect(h.statements.some((s) => s.includes('= NULL'))).toBe(true)
  })

  it('releases the notice when sending throws, and carries on with the next trial', async () => {
    h.candidates = [row(2.5 * DAY), { ...row(2 * DAY), id: 2, org_id: 10 }]
    h.send.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true)
    const out = await runTrialReminders(NOW)
    expect(out).toMatchObject({ sent: 1, failed: 1 })
  })

  it('skips a workspace with no owner email instead of failing', async () => {
    h.candidates = [row(2.5 * DAY)]
    h.owner = { email: null, name: null }
    const out = await runTrialReminders(NOW)
    expect(h.send).not.toHaveBeenCalled()
    expect(out.failed).toBe(0)
  })

  it('only ever claims an app-run trial', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/billing/trial-reminders.ts'), 'utf-8')
    expect(src).toContain("status = 'trialing' AND stripe_subscription_id IS NULL")
  })
})

describe('POST /api/billing/trial-reminders/run', () => {
  it('401 without the bot secret', async () => {
    vi.resetModules()
    vi.doMock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: () => false }))
    const { POST } = await import('@/app/api/billing/trial-reminders/run/route')
    expect((await POST(new Request('https://x.test/api', { method: 'POST' }))).status).toBe(401)
  })

  it('does nothing on a self-hosted deployment', async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    const run = vi.fn()
    vi.doMock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: () => true }))
    vi.doMock('@/lib/billing/trial-reminders', () => ({ runTrialReminders: run }))
    const { POST } = await import('@/app/api/billing/trial-reminders/run/route')
    const res = await POST(new Request('https://x.test/api', { method: 'POST' }))
    expect(await res.json()).toMatchObject({ ok: true, sent: 0 })
    expect(run).not.toHaveBeenCalled()
  })

  it('is reachable by the bot without a session, and the bot actually calls it', () => {
    const auth = fs.readFileSync(path.join(process.cwd(), 'auth.ts'), 'utf-8')
    expect(auth).toContain("'/api/billing/trial-reminders/run'")
    const bot = fs.readFileSync(path.join(process.cwd(), 'bot/index.ts'), 'utf-8')
    expect(bot).toContain('/api/billing/trial-reminders/run')
    expect(bot).toMatch(/\n\s*startTrialReminderSweep\(\)/)
  })
})
