// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createNotification: vi.fn(),
  sendPushToAll: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification: h.createNotification }))
vi.mock('@/lib/push/notify', () => ({ sendPushToAll: h.sendPushToAll }))
vi.mock('@/lib/logger', () => ({ logger: { warn: h.warn, error: vi.fn(), info: vi.fn() } }))

import { activitySnippet, notifyTicketActivity } from '@/lib/tickets/notify-activity'

beforeEach(() => {
  vi.clearAllMocks()
  h.createNotification.mockResolvedValue({})
  h.sendPushToAll.mockResolvedValue(undefined)
})

describe('activitySnippet', () => {
  it('leaves short text unchanged', () => {
    expect(activitySnippet('still broken')).toBe('still broken')
  })

  it('collapses whitespace and newlines', () => {
    expect(activitySnippet('  one\n\n two\t three  ')).toBe('one two three')
  })

  it('truncates long text at a word with an ellipsis', () => {
    const text = Array.from({ length: 60 }, () => 'word').join(' ')
    const out = activitySnippet(text)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(141)
    expect(out.slice(0, -1).split(' ').every((w) => w === 'word')).toBe(true)
  })

  it('cuts mid-word when there is no usable space', () => {
    const out = activitySnippet('a'.repeat(300))
    expect(out).toBe(`${'a'.repeat(140)}…`)
  })
})

describe('notifyTicketActivity', () => {
  const ticket = { id: 42, org_ticket_number: 17, source_platform: 'slack' } as const

  it('creates a ticket_activity notification naming author, number, platform and snippet', async () => {
    await notifyTicketActivity({ ticket, authorName: 'alice', content: 'it broke again', orgId: 3 })
    expect(h.createNotification).toHaveBeenCalledTimes(1)
    const [type, message, ticketId, orgId] = h.createNotification.mock.calls[0]
    expect(type).toBe('ticket_activity')
    expect(message).toContain('alice')
    expect(message).toContain('#17')
    expect(message).toContain('Slack')
    expect(message).toContain('it broke again')
    expect(ticketId).toBe(42)
    expect(orgId).toBe(3)
  })

  it('sends exactly one push with the ticket url, a per-ticket tag, and author/platform/snippet', async () => {
    await notifyTicketActivity({ ticket, authorName: 'alice', content: 'it broke again', orgId: 3 })
    expect(h.sendPushToAll).toHaveBeenCalledTimes(1)
    const [payload, orgId] = h.sendPushToAll.mock.calls[0]
    expect(payload.url).toBe('/tickets/17')
    expect(payload.tag).toBe('ticket-42')
    expect(payload.title).toContain('#17')
    expect(payload.body).toContain('alice')
    expect(payload.body).toContain('Slack')
    expect(payload.body).toContain('it broke again')
    expect(orgId).toBe(3)
  })

  it('does not throw when the push fails, and logs it', async () => {
    h.sendPushToAll.mockRejectedValue(new Error('push down'))
    await expect(notifyTicketActivity({ ticket, authorName: 'alice', content: 'hi', orgId: 3 })).resolves.toBeUndefined()
    expect(h.createNotification).toHaveBeenCalledTimes(1)
    expect(h.warn).toHaveBeenCalled()
  })

  it('omits the snippet separator when the content is blank', async () => {
    await notifyTicketActivity({ ticket, authorName: 'alice', content: '   ', orgId: 3 })
    expect(h.createNotification.mock.calls[0][1]).toBe('alice replied on #17 (Slack)')
    expect(h.sendPushToAll.mock.calls[0][0].body).toBe('alice on Slack')
  })
})
