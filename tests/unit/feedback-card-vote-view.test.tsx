// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { BoardFeedback } from '@/lib/product-feedback/validation'

const actions = vi.hoisted(() => ({ voteProductFeedbackAction: vi.fn() }))
vi.mock('@/lib/actions/product-feedback', () => actions)

import { FeedbackCard } from '@/components/feedback/feedback-card'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  actions.voteProductFeedbackAction.mockResolvedValue({ ok: true, state: 'added' })
})

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
  return render(
    <ul>
      <FeedbackCard item={i} />
    </ul>,
  )
}
function rerenderCard(rerender: ReturnType<typeof render>['rerender'], i: BoardFeedback) {
  rerender(
    <ul>
      <FeedbackCard item={i} />
    </ul>,
  )
}

const voteButton = () => screen.getByRole('button', { name: /upvote/i }) as HTMLButtonElement
const settled = () => waitFor(() => expect(voteButton().disabled).toBe(false))

describe("author's read-only count chip", () => {
  it.each([
    [0, '0 upvotes'],
    [1, '1 upvote'],
    [4, '4 upvotes'],
  ])('labels a count of %i as "%s" and renders no button', (voteCount, label) => {
    renderCard(item({ mine: true, voteCount }))
    const chip = screen.getByLabelText(label)
    expect(chip.tagName).toBe('SPAN')
    expect(chip.textContent).toBe(String(voteCount))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shares the vote button chip shape, so the two never drift apart', () => {
    const { unmount } = renderCard(item({ voteCount: 2 }))
    const buttonClasses = voteButton().className.split(/\s+/)
    unmount()
    renderCard(item({ mine: true, voteCount: 2 }))
    const chipClasses = screen.getByLabelText('2 upvotes').className.split(/\s+/)
    for (const c of ['inline-flex', 'h-8', 'rounded-lg', 'border', 'px-2', 'text-xs', 'font-semibold', 'tabular-nums']) {
      expect(buttonClasses).toContain(c)
      expect(chipClasses).toContain(c)
    }
  })

  it('does not call the server or react to a click', () => {
    renderCard(item({ mine: true, voteCount: 3 }))
    fireEvent.click(screen.getByLabelText('3 upvotes'))
    expect(actions.voteProductFeedbackAction).not.toHaveBeenCalled()
    expect(screen.getByLabelText('3 upvotes')).toBeTruthy()
  })

  it('follows the snapshot when a refetch brings a new count', () => {
    const { rerender } = renderCard(item({ mine: true, voteCount: 1 }))
    expect(screen.getByLabelText('1 upvote')).toBeTruthy()
    rerenderCard(rerender, item({ mine: true, voteCount: 2 }))
    expect(screen.getByLabelText('2 upvotes')).toBeTruthy()
  })
})

describe('vote button label', () => {
  it('uses the singular for exactly one vote and the plural otherwise', () => {
    const { rerender } = renderCard(item({ voteCount: 1 }))
    expect(screen.getByRole('button', { name: 'Upvote, 1 vote' })).toBeTruthy()
    rerenderCard(rerender, item({ voteCount: 0 }))
    expect(screen.getByRole('button', { name: 'Upvote, 0 votes' })).toBeTruthy()
    rerenderCard(rerender, item({ voteCount: 2, viewerVoted: true }))
    expect(screen.getByRole('button', { name: 'Remove your upvote, 2 votes' })).toBeTruthy()
  })

  it('switches from plural to singular as the optimistic vote is removed', async () => {
    actions.voteProductFeedbackAction.mockResolvedValue({ ok: true, state: 'removed' })
    renderCard(item({ voteCount: 2, viewerVoted: true }))
    fireEvent.click(voteButton())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upvote, 1 vote' })).toBeTruthy())
    await settled()
    expect(screen.getByRole('button', { name: 'Upvote, 1 vote' })).toBeTruthy()
  })
})

describe('applyVote clamping', () => {
  it('never shows a negative count when removing a vote from a snapshot that says 0', async () => {
    // An inconsistent snapshot (voted, but count 0), e.g. mid-refetch.
    actions.voteProductFeedbackAction.mockResolvedValue({ ok: true, state: 'removed' })
    renderCard(item({ voteCount: 0, viewerVoted: true }))
    fireEvent.click(voteButton())
    await waitFor(() => expect(voteButton().getAttribute('aria-pressed')).toBe('false'))
    expect(voteButton().textContent).toBe('0')
    await settled()
    expect(voteButton().textContent).toBe('0')
    expect(voteButton().getAttribute('aria-label')).toBe('Upvote, 0 votes')
  })
})

describe('confirmed answer', () => {
  it('holds a confirmed removal across a re-render of the same snapshot, and the next click votes again from it', async () => {
    actions.voteProductFeedbackAction.mockResolvedValueOnce({ ok: true, state: 'removed' })
    const snapshot = item({ voteCount: 5, viewerVoted: true })
    const { rerender } = renderCard(snapshot)
    fireEvent.click(voteButton())
    await settled()
    expect(voteButton().textContent).toBe('4')
    expect(voteButton().getAttribute('aria-pressed')).toBe('false')

    rerenderCard(rerender, snapshot)
    expect(voteButton().textContent).toBe('4')
    expect(voteButton().getAttribute('aria-pressed')).toBe('false')

    // The wanted state is derived from what is on screen, not from the stale prop.
    fireEvent.click(voteButton())
    await waitFor(() => expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(2))
    expect(actions.voteProductFeedbackAction).toHaveBeenLastCalledWith({ feedbackId: 1, voted: true })
    await settled()
    expect(voteButton().textContent).toBe('5')
    expect(voteButton().getAttribute('aria-pressed')).toBe('true')
  })

  it('ignores a confirmed removal once a new item object arrives with the click-time numbers', async () => {
    // Tab B re-cast the vote before the refetch: {5, voted} is the click-time
    // value again, but it is a new object, so the server snapshot wins.
    actions.voteProductFeedbackAction.mockResolvedValueOnce({ ok: true, state: 'removed' })
    const { rerender } = renderCard(item({ voteCount: 5, viewerVoted: true }))
    fireEvent.click(voteButton())
    await settled()
    expect(voteButton().textContent).toBe('4')

    rerenderCard(rerender, item({ voteCount: 5, viewerVoted: true }))
    expect(voteButton().textContent).toBe('5')
    expect(voteButton().getAttribute('aria-pressed')).toBe('true')
    expect(voteButton().getAttribute('aria-label')).toBe('Remove your upvote, 5 votes')
  })

  it('does not double count when the server says "added" for a vote the snapshot already has', async () => {
    // The click asks to remove (snapshot says voted), but another tab has
    // meanwhile removed and re-added, so the server answers "added".
    actions.voteProductFeedbackAction.mockResolvedValue({ ok: true, state: 'added' })
    renderCard(item({ voteCount: 3, viewerVoted: true }))
    fireEvent.click(voteButton())
    await waitFor(() => expect(actions.voteProductFeedbackAction).toHaveBeenCalledWith({ feedbackId: 1, voted: false }))
    await settled()
    expect(voteButton().textContent).toBe('3')
    expect(voteButton().getAttribute('aria-pressed')).toBe('true')
  })

  it('does not take a second off the count when the server says "removed" for a vote the snapshot never had', async () => {
    actions.voteProductFeedbackAction.mockResolvedValue({ ok: true, state: 'removed' })
    renderCard(item({ voteCount: 0, viewerVoted: false }))
    fireEvent.click(voteButton())
    await settled()
    expect(voteButton().textContent).toBe('0')
    expect(voteButton().getAttribute('aria-pressed')).toBe('false')
  })
})

describe('refused or rejected votes leave the snapshot untouched', () => {
  it.each([
    ['refused', () => actions.voteProductFeedbackAction.mockResolvedValue({ ok: false, error: 'Not allowed.' })],
    ['rejected', () => actions.voteProductFeedbackAction.mockRejectedValue(new Error('offline'))],
  ])('a %s removal keeps the voted state and count, and a later click retries the removal', async (_name, arrange) => {
    arrange()
    renderCard(item({ voteCount: 4, viewerVoted: true }))
    fireEvent.click(voteButton())
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    await settled()
    expect(voteButton().textContent).toBe('4')
    expect(voteButton().getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(voteButton())
    await waitFor(() => expect(actions.voteProductFeedbackAction).toHaveBeenCalledTimes(2))
    expect(actions.voteProductFeedbackAction).toHaveBeenLastCalledWith({ feedbackId: 1, voted: false })
    await settled()
  })

  it('a refusal does not leave a confirmed answer behind that would mask the next snapshot', async () => {
    actions.voteProductFeedbackAction.mockResolvedValue({ ok: false, error: 'Not allowed.' })
    const { rerender } = renderCard(item({ voteCount: 2 }))
    fireEvent.click(voteButton())
    await screen.findByText('Not allowed.')
    await settled()
    rerenderCard(rerender, item({ voteCount: 9, viewerVoted: true }))
    expect(voteButton().textContent).toBe('9')
    expect(voteButton().getAttribute('aria-pressed')).toBe('true')
  })
})
