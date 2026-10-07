// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FeedbackCard } from '@/components/feedback/feedback-card'
import type { BoardFeedback } from '@/lib/product-feedback/validation'

afterEach(cleanup)

// Midday UTC keeps the calendar day stable in every realistic local timezone.
function item(overrides: Partial<BoardFeedback> = {}): BoardFeedback {
  return {
    id: 1,
    authorLabel: 'Acme user feedback',
    body: 'Nice tool, the replies feel natural.',
    status: 'approved',
    createdAt: '2026-10-05T12:00:00.000Z',
    approvedAt: '2026-10-06T12:00:00.000Z',
    mine: false,
    reply: null,
    ...overrides,
  }
}

function renderCard(i: BoardFeedback) {
  // FeedbackCard renders an <li>, so give it a list parent.
  return render(
    <ul>
      <FeedbackCard item={i} />
    </ul>,
  )
}

describe('date stamp', () => {
  it('uses the approval date for approved entries', () => {
    renderCard(item())
    expect(screen.getByText(/^Approved Oct 6, 2026/)).toBeTruthy()
    expect(screen.queryByText(/Oct 5, 2026/)).toBeNull()
  })

  it('falls back to the status note and created date when approved but approvedAt is missing', () => {
    renderCard(item({ approvedAt: null }))
    expect(screen.getByText(/^Approved · Oct 5, 2026/)).toBeTruthy()
  })

  it('shows "Pending review · <created>" for pending entries even if approvedAt is set', () => {
    renderCard(item({ status: 'pending' }))
    expect(screen.getByText(/^Pending review · Oct 5, 2026/)).toBeTruthy()
  })

  it('shows "Not approved · <created>" for rejected entries', () => {
    renderCard(item({ status: 'rejected', approvedAt: null }))
    expect(screen.getByText(/^Not approved · Oct 5, 2026/)).toBeTruthy()
  })

  it('accepts the Postgres text timestamp format', () => {
    renderCard(item({ approvedAt: '2026-10-06 12:00:00.123+00' }))
    expect(screen.getByText(/^Approved Oct 6, 2026/)).toBeTruthy()
  })

  it('renders no "Invalid Date" or NaN when the date is unparseable', () => {
    const { container } = renderCard(item({ approvedAt: 'not-a-date' }))
    expect(container.textContent).not.toMatch(/invalid date|nan/i)
    // formatBoardDate yields '' so the stamp is just the label.
    expect(screen.getByText('Approved')).toBeTruthy()
  })

  it('renders a clean pending stamp when createdAt is unparseable', () => {
    const { container } = renderCard(item({ status: 'pending', createdAt: '' }))
    expect(container.textContent).not.toMatch(/invalid date|nan/i)
  })
})

describe('badges', () => {
  it('shows no badges for an approved entry that is not mine', () => {
    renderCard(item())
    expect(screen.queryByText('You')).toBeNull()
    expect(screen.queryByText('Not approved')).toBeNull()
    expect(screen.queryByText('Pending review')).toBeNull()
  })

  it('shows only the "You" badge for my approved entry', () => {
    renderCard(item({ mine: true }))
    expect(screen.getByText('You')).toBeTruthy()
    expect(screen.queryByText('Pending review')).toBeNull()
  })

  it('shows a "Pending review" badge (in addition to the stamp) for pending entries', () => {
    renderCard(item({ status: 'pending' }))
    expect(screen.getAllByText(/Pending review/)).toHaveLength(2)
    expect(screen.queryByText('You')).toBeNull()
  })

  it('shows both "You" and "Not approved" for my rejected entry', () => {
    renderCard(item({ status: 'rejected', mine: true }))
    expect(screen.getByText('You')).toBeTruthy()
    expect(screen.getByText('Not approved')).toBeTruthy()
  })
})

describe('reply', () => {
  it('renders no reply block when there is no reply', () => {
    renderCard(item())
    expect(screen.queryByText('answerLoops')).toBeNull()
  })

  it('renders the reply body and the tag label', () => {
    renderCard(item({ reply: { body: 'Thanks for the kind words!', tag: 'planned', repliedAt: '2026-10-06T12:00:00.000Z' } }))
    expect(screen.getByText('answerLoops')).toBeTruthy()
    expect(screen.getByText('Thanks for the kind words!')).toBeTruthy()
    expect(screen.getByText('Planned')).toBeTruthy()
  })

  it.each([
    ['great_feedback', 'Great feedback'],
    ['planned', 'Planned'],
    ['shipped', 'Shipped'],
    ['considering', 'Considering'],
  ] as const)('maps tag %s to the label "%s"', (tag, label) => {
    renderCard(item({ reply: { body: 'ok', tag, repliedAt: '2026-10-06T12:00:00.000Z' } }))
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('renders a reply with no tag and no tag label', () => {
    renderCard(item({ reply: { body: 'Noted.', tag: null, repliedAt: '2026-10-06T12:00:00.000Z' } }))
    expect(screen.getByText('Noted.')).toBeTruthy()
    for (const label of ['Great feedback', 'Planned', 'Shipped', 'Considering']) {
      expect(screen.queryByText(label)).toBeNull()
    }
  })

  it('preserves line breaks in the reply body', () => {
    renderCard(item({ reply: { body: 'Line one\nLine two', tag: null, repliedAt: '2026-10-06T12:00:00.000Z' } }))
    const p = screen.getByText(/Line one/)
    expect(p.textContent).toBe('Line one\nLine two')
    expect(p.className).toContain('whitespace-pre-wrap') // no stylesheet in happy-dom; assert the class carrying the rule
  })
})

describe('body content', () => {
  it('shows the author label', () => {
    renderCard(item({ authorLabel: 'Anonymous' }))
    expect(screen.getByText('Anonymous')).toBeTruthy()
  })

  it('preserves newlines and spacing and wraps with pre-wrap', () => {
    renderCard(item({ body: 'First line\n\n  indented second' }))
    const p = screen.getByText(/First line/)
    expect(p.textContent).toBe('First line\n\n  indented second')
    expect(p.className).toContain('whitespace-pre-wrap') // no stylesheet in happy-dom; assert the class carrying the rule
  })

  it('renders HTML in the body as literal text, never as elements', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const { container } = renderCard(item({ body: evil }))
    expect(screen.getByText(evil)).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders HTML in author label and reply as text', () => {
    const { container } = renderCard(
      item({
        authorLabel: '<b>bold</b>',
        reply: { body: '<script>alert(1)</script>', tag: null, repliedAt: '2026-10-06T12:00:00.000Z' },
      }),
    )
    expect(screen.getByText('<b>bold</b>')).toBeTruthy()
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    expect(container.querySelector('b, script')).toBeNull()
  })

  it('keeps a very long unbroken body intact (wrapped by CSS, not truncated)', () => {
    const long = 'x'.repeat(500)
    renderCard(item({ body: long }))
    expect(screen.getByText(long).textContent).toHaveLength(500)
  })
})
