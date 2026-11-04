// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import type { BoardFeedback } from '@/lib/product-feedback/validation'

const actions = vi.hoisted(() => ({ voteProductFeedbackAction: vi.fn() }))
vi.mock('@/lib/actions/product-feedback', () => actions)

import { FeedbackCard } from '@/components/feedback/feedback-card'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  actions.voteProductFeedbackAction.mockResolvedValue({ ok: true, state: 'added' })
})

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
    voteCount: 0,
    viewerVoted: false,
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
    expect(screen.queryByText('Nathan @ answerLoops')).toBeNull()
  })

  it('renders the reply body and the tag label', () => {
    renderCard(item({ reply: { body: 'Thanks for the kind words!', tag: 'planned', repliedAt: '2026-10-06T12:00:00.000Z' } }))
    expect(screen.getByText('Nathan @ answerLoops')).toBeTruthy()
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

describe('up-vote control', () => {
  const upvote = () => screen.queryByRole('button', { name: /upvote/i })

  it('renders the arrow with the count on another person approved entry', () => {
    renderCard(item({ voteCount: 3 }))
    const b = upvote()
    expect(b).toBeTruthy()
    expect(b!.getAttribute('aria-pressed')).toBe('false')
    expect(b!.textContent).toContain('3')
  })

  it('reflects the viewer own vote as pressed, with a label that says how to take it back', () => {
    renderCard(item({ voteCount: 1, viewerVoted: true }))
    const b = screen.getByRole('button', { name: /remove your upvote/i })
    expect(b.getAttribute('aria-pressed')).toBe('true')
  })

  it('renders no control on the viewer own entry — only a read-only count', () => {
    renderCard(item({ mine: true, voteCount: 4 }))
    expect(upvote()).toBeNull()
    expect(screen.getByText('4')).toBeTruthy()
  })

  it.each(['pending', 'rejected'] as const)('renders no control and no count on a %s entry', (status) => {
    renderCard(item({ status, voteCount: 2 }))
    expect(upvote()).toBeNull()
    expect(screen.queryByText('2')).toBeNull()
  })

  it('never puts a control in the team reply block, and there is no down arrow anywhere', () => {
    const { container } = renderCard(
      item({ voteCount: 1, reply: { body: 'Thanks!', tag: 'planned', repliedAt: '2026-10-06T12:00:00.000Z' } }),
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(container.textContent).not.toMatch(/down/i)
    expect(container.querySelector('[aria-label*="down" i]')).toBeNull()
  })

  it('counts the vote at once on click, then keeps it when the server agrees', async () => {
    let resolve!: (v: unknown) => void
    actions.voteProductFeedbackAction.mockImplementation(() => new Promise((r) => (resolve = r)))
    renderCard(item({ voteCount: 2 }))
    fireEvent.click(upvote()!)
    await waitFor(() => expect(upvote()!.getAttribute('aria-pressed')).toBe('true'))
    expect(upvote()!.textContent).toContain('3')
    resolve({ ok: true, state: 'added' })
    await waitFor(() => expect(actions.voteProductFeedbackAction).toHaveBeenCalledWith({ feedbackId: 1, voted: true }))
    // Wait for the transition to settle: only then is the shown value the
    // confirmed one rather than the optimistic one.
    await waitFor(() => expect((upvote() as HTMLButtonElement).disabled).toBe(false))
    expect(upvote()!.textContent).toContain('3')
    expect(upvote()!.getAttribute('aria-pressed')).toBe('true')
  })

  it('takes the vote back on a second click', async () => {
    actions.voteProductFeedbackAction.mockResolvedValue({ ok: true, state: 'removed' })
    renderCard(item({ voteCount: 5, viewerVoted: true }))
    fireEvent.click(screen.getByRole('button', { name: /remove your upvote/i }))
    await waitFor(() => expect(upvote()!.getAttribute('aria-pressed')).toBe('false'))
    expect(upvote()!.textContent).toContain('4')
  })

  it('reverts and shows the message when the server refuses', async () => {
    actions.voteProductFeedbackAction.mockResolvedValue({ ok: false, error: 'This entry cannot be voted on.' })
    renderCard(item({ voteCount: 2 }))
    fireEvent.click(upvote()!)
    expect(await screen.findByText('This entry cannot be voted on.')).toBeTruthy()
    await waitFor(() => expect(upvote()!.getAttribute('aria-pressed')).toBe('false'))
    expect(upvote()!.textContent).toContain('2')
  })

  it('sends the entry id and the wanted state — never who is voting', async () => {
    renderCard(item({ id: 77 }))
    fireEvent.click(upvote()!)
    await waitFor(() => expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(1))
    expect(actions.voteProductFeedbackAction).toHaveBeenCalledWith({ feedbackId: 77, voted: true })
  })

  it('keeps the confirmed count while the parent re-renders with the same stale prop, then yields to a new prop', async () => {
    const { rerender } = renderCard(item({ voteCount: 2 }))
    fireEvent.click(upvote()!)
    await waitFor(() => expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((upvote() as HTMLButtonElement).disabled).toBe(false))
    expect(upvote()!.getAttribute('aria-pressed')).toBe('true')
    expect(upvote()!.textContent).toContain('3')

    // The parent re-renders before its refetch lands: same prop, so the
    // server's confirmed answer must not flicker back to the stale 2.
    rerender(
      <ul>
        <FeedbackCard item={item({ voteCount: 2 })} />
      </ul>,
    )
    expect(upvote()!.textContent).toContain('3')
    expect(upvote()!.getAttribute('aria-pressed')).toBe('true')

    // The refetch arrives with a different count (others voted too): the
    // snapshot wins and the remembered answer is dropped.
    rerender(
      <ul>
        <FeedbackCard item={item({ voteCount: 7, viewerVoted: true })} />
      </ul>,
    )
    expect(upvote()!.textContent).toContain('7')
    expect(upvote()!.getAttribute('aria-pressed')).toBe('true')
  })

  it('drops the remembered answer once the snapshot moves, so a later snapshot equal to the click-time value is believed', async () => {
    // Tab A votes 5→6 and remembers the server's "added". The refetch brings
    // {6, voted}. Then tab B removes the vote and the refetch brings {5, not
    // voted} — exactly the click-time value. The snapshot must win.
    const { rerender } = renderCard(item({ voteCount: 5 }))
    fireEvent.click(upvote()!)
    await waitFor(() => expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((upvote() as HTMLButtonElement).disabled).toBe(false))
    expect(upvote()!.textContent).toContain('6')

    rerender(
      <ul>
        <FeedbackCard item={item({ voteCount: 6, viewerVoted: true })} />
      </ul>,
    )
    expect(upvote()!.textContent).toContain('6')
    expect(upvote()!.getAttribute('aria-pressed')).toBe('true')

    rerender(
      <ul>
        <FeedbackCard item={item({ voteCount: 5, viewerVoted: false })} />
      </ul>,
    )
    expect(upvote()!.textContent).toContain('5')
    expect(upvote()!.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: /^upvote, 5 votes$/i })).toBeTruthy()
  })

  it('follows the server answer when it disagrees with the optimistic guess (vote already cast elsewhere)', async () => {
    // The prop says "not voted", but another tab already voted, so the toggle removes it.
    actions.voteProductFeedbackAction.mockResolvedValue({ ok: true, state: 'removed' })
    renderCard(item({ voteCount: 2 }))
    fireEvent.click(upvote()!)
    await waitFor(() => expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((upvote() as HTMLButtonElement).disabled).toBe(false))
    expect(upvote()!.getAttribute('aria-pressed')).toBe('false')
    expect(upvote()!.textContent).toContain('2')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the card on screen, reverts and re-enables the button when the action rejects outright', async () => {
    // A network blip rejects the server action instead of returning { ok: false }.
    actions.voteProductFeedbackAction.mockRejectedValue(new Error('network down'))
    const { container } = renderCard(item({ voteCount: 2, body: 'Still here after the blip.' }))
    fireEvent.click(upvote()!)
    await waitFor(() => expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(1))
    // Let the rejection settle before looking at what is left on screen.
    await act(async () => {})
    // The card must survive the failure — a rejected vote is not a reason to blank the board.
    expect(container.querySelector('li')).not.toBeNull()
    expect(screen.queryByText('Still here after the blip.')).not.toBeNull()
    // And the person is told why nothing changed.
    expect(await screen.findByText('Your vote was not saved. Please try again.')).toBeTruthy()
    await waitFor(() => expect((upvote() as HTMLButtonElement).disabled).toBe(false))
    expect(upvote()!.getAttribute('aria-pressed')).toBe('false')
    expect(upvote()!.textContent).toContain('2')
  })

  it('ignores a second click while the first request is still in flight', async () => {
    let resolve!: (v: unknown) => void
    actions.voteProductFeedbackAction.mockImplementation(() => new Promise((r) => (resolve = r)))
    renderCard(item({ voteCount: 2 }))
    fireEvent.click(upvote()!)
    await waitFor(() => expect((upvote() as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(upvote()!)
    fireEvent.click(upvote()!)
    expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(1)
    // Still the optimistic +1 — the extra clicks did not toggle it back.
    expect(upvote()!.textContent).toContain('3')
    resolve({ ok: true, state: 'added' })
    await waitFor(() => expect((upvote() as HTMLButtonElement).disabled).toBe(false))
    expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(1)
    expect(upvote()!.textContent).toContain('3')
  })

  it('clears the refusal message on the next click', async () => {
    actions.voteProductFeedbackAction.mockResolvedValueOnce({ ok: false, error: 'Try again in a moment.' })
    renderCard(item({ voteCount: 2 }))
    fireEvent.click(upvote()!)
    expect(await screen.findByText('Try again in a moment.')).toBeTruthy()
    await waitFor(() => expect((upvote() as HTMLButtonElement).disabled).toBe(false))

    // Default mock: the retry succeeds.
    fireEvent.click(upvote()!)
    await waitFor(() => expect(screen.queryByText('Try again in a moment.')).toBeNull())
    await waitFor(() => expect(upvote()!.getAttribute('aria-pressed')).toBe('true'))
    expect(upvote()!.textContent).toContain('3')
    expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(2)
  })
})
