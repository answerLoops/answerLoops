import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * lib/kb/review-capture.ts — best-effort capture of unseen questions. It runs
 * beside live answers, so it must be gated by plan, bounded in size, and never
 * throw.
 */

const h = vi.hoisted(() => ({
  orgHasFeature: vi.fn(),
  embedText: vi.fn(),
  recordReviewItem: vi.fn(),
}))

vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/ai/embed', () => ({ embedText: h.embedText }))
vi.mock('@/lib/db/queries/kb-review', () => ({ recordReviewItem: h.recordReviewItem }))

beforeEach(() => {
  vi.clearAllMocks()
  h.orgHasFeature.mockResolvedValue(true)
  h.embedText.mockResolvedValue([1, 2, 3])
  h.recordReviewItem.mockResolvedValue('created')
})

async function capture(input: Partial<Parameters<typeof import('@/lib/kb/review-capture').captureUnansweredQuestion>[0]> = {}) {
  const { captureUnansweredQuestion } = await import('@/lib/kb/review-capture')
  return captureUnansweredQuestion({ orgId: 7, source: 'ticket', question: 'How do I export data?', answer: 'Use Settings > Export.', ...input })
}

describe('captureUnansweredQuestion', () => {
  it('records the question for the org with its embedding', async () => {
    await capture({ ticketId: 11, confidence: 0.4 })
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'kb_review_queue')
    expect(h.embedText).toHaveBeenCalledWith('How do I export data?', 7)
    expect(h.recordReviewItem).toHaveBeenCalledWith(
      {
        source: 'ticket',
        ticketId: 11,
        question: 'How do I export data?',
        answer: 'Use Settings > Export.',
        embedding: [1, 2, 3],
        confidence: 0.4,
      },
      7
    )
  })

  it('captures nothing and embeds nothing for an org without the feature', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    await capture()
    expect(h.embedText).not.toHaveBeenCalled()
    expect(h.recordReviewItem).not.toHaveBeenCalled()
  })

  it('reuses a vector the caller already has instead of embedding again', async () => {
    await capture({ source: 'widget', embedding: [9, 9] })
    expect(h.embedText).not.toHaveBeenCalled()
    expect(h.recordReviewItem.mock.calls[0][0]).toMatchObject({ source: 'widget', embedding: [9, 9] })
  })

  it('keeps an unanswered question (empty answer) so a reviewer can write one', async () => {
    await capture({ answer: '' })
    expect(h.recordReviewItem.mock.calls[0][0]).toMatchObject({ answer: '' })
  })

  it('drops attachment lines from a question that also has text', async () => {
    await capture({ question: 'Why does export fail?\n[Attachment: log.txt] — https://example.com/log' })
    expect(h.recordReviewItem.mock.calls[0][0].question).toBe('Why does export fail?')
  })

  it('skips a blank question and one that is only attachments', async () => {
    await capture({ question: '   ' })
    await capture({ question: '[Attachment: screenshot.png] — https://example.com/a.png' })
    expect(h.recordReviewItem).not.toHaveBeenCalled()
  })

  it('bounds stored question and answer length', async () => {
    await capture({ question: 'q'.repeat(2000), answer: 'a'.repeat(20000) })
    const stored = h.recordReviewItem.mock.calls[0][0]
    expect(stored.question).toHaveLength(500)
    expect(stored.answer).toHaveLength(4000)
  })

  it('never throws: embedding, plan lookup and DB failures are swallowed', async () => {
    h.embedText.mockRejectedValue(new Error('provider down'))
    await expect(capture()).resolves.toBeUndefined()
    h.embedText.mockResolvedValue([1])
    h.recordReviewItem.mockRejectedValue(new Error('db down'))
    await expect(capture()).resolves.toBeUndefined()
    h.orgHasFeature.mockRejectedValue(new Error('billing down'))
    await expect(capture()).resolves.toBeUndefined()
  })
})

describe('captureUnansweredQuestion — stored text', () => {
  it('replaces emails, phone numbers and long digit runs in the question and answer', async () => {
    await capture({
      question: 'My email is jo@example.com, call +1 (555) 010-2030 about order 123456789',
      answer: 'We will write to jo@example.com or phone 555.010.2030; reference 9876543210.',
    })
    const stored = h.recordReviewItem.mock.calls[0][0]
    expect(stored.question).toBe('My email is [email], call [phone] about order [number]')
    expect(stored.answer).toBe('We will write to [email] or phone [phone]; reference [number].')
  })

  it('leaves digit runs embedded in identifiers alone', async () => {
    const { scrubPersonalData } = await import('@/lib/kb/review-capture')
    expect(scrubPersonalData('How do I qz1234567890ab configure build_20261015_x?')).toBe(
      'How do I qz1234567890ab configure build_20261015_x?'
    )
    expect(scrubPersonalData('Order #1234567 and ref 7654321.')).toBe('Order #[number] and ref [number].')
  })

  it('leaves ordinary numbers and versions alone', async () => {
    const { scrubPersonalData } = await import('@/lib/kb/review-capture')
    expect(scrubPersonalData('Upgrade to v2.4.1 within 30 days for 12 seats')).toBe('Upgrade to v2.4.1 within 30 days for 12 seats')
    expect(scrubPersonalData('Renews on 2026-10-15')).toBe('Renews on 2026-10-15')
  })

  it('embeds the scrubbed question when no vector was supplied', async () => {
    await capture({ question: 'Mail jo@example.com about exports' })
    expect(h.embedText).toHaveBeenCalledWith('Mail [email] about exports', 7)
  })

  it('does not rewrite dates, times, IP addresses or version strings', async () => {
    const { scrubPersonalData } = await import('@/lib/kb/review-capture')
    for (const text of [
      'It failed on 2026-10-15 12:30 again',
      'Logged at 2026-10-15T12:30:45 UTC',
      'At 12:30 2026-10-15 it stopped',
      'Server at 192.168.100.200 is down',
      'Windows build 10.0.19045.3693 here',
      'Ran 1.22.333.4444 yesterday',
    ]) {
      expect(scrubPersonalData(text)).toBe(text)
    }
  })

  it('still rewrites plausible phone numbers', async () => {
    const { scrubPersonalData } = await import('@/lib/kb/review-capture')
    expect(scrubPersonalData('Call +44 20 7946 0958 now')).toBe('Call [phone] now')
    expect(scrubPersonalData('Call (555) 010-2030 now')).toBe('Call [phone] now')
    expect(scrubPersonalData('Call 555-010-2030 now')).toBe('Call [phone] now')
    expect(scrubPersonalData('Call 07911 123456 now')).toBe('Call [phone] now')
  })
})
