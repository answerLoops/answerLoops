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
    expect(h.embedText).toHaveBeenCalledWith('How do I export data?', 7, undefined)
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
