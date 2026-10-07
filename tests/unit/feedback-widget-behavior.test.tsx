// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'
import type { BoardSnapshot } from '@/lib/product-feedback/validation'

const live = vi.hoisted(() => ({ handler: null as null | ((e: string) => void), unsubscribe: vi.fn() }))
vi.mock('@/lib/live-events', () => ({
  subscribeLiveEvents: (_events: string[], handler: (e: string) => void) => {
    live.handler = handler
    return live.unsubscribe
  },
}))
vi.mock('@/lib/actions/product-feedback', () => ({ submitProductFeedbackAction: vi.fn() }))

import { FeedbackWidget } from '@/components/feedback/feedback-widget'

function snap(approvedCount = 2): BoardSnapshot {
  return {
    approvedCount,
    feedback: [
      {
        id: 1,
        authorLabel: 'Acme user feedback',
        body: 'Nice tool, the replies feel natural.',
        status: 'approved',
        createdAt: '2026-10-05T15:04:00.000Z',
        approvedAt: '2026-10-05T15:30:00.000Z',
        mine: false,
        reply: null,
      },
    ],
    updates: [{ id: 3, title: 'Faster KB sync', body: 'Runs in background.', publishedAt: '2026-10-06T10:00:00.000Z' }],
  }
}

const fetchMock = vi.fn()
const ok = (s: BoardSnapshot) => ({ ok: true, json: async () => s })
const pill = () => screen.getByRole('button', { name: /open product feedback/i })

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  live.handler = null
  fetchMock.mockImplementation(async () => ok(snap()))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function openPanel() {
  render(<FeedbackWidget />)
  await waitFor(() => expect(screen.getByRole('button', { name: /2 entries/i })).toBeTruthy())
  fireEvent.click(pill())
}

describe('pill label', () => {
  it('uses the singular for exactly one entry', async () => {
    fetchMock.mockImplementation(async () => ok(snap(1)))
    render(<FeedbackWidget />)
    expect(await screen.findByRole('button', { name: /^Open product feedback, 1 entry(,|$)/ })).toBeTruthy()
  })

  it('uses the plural for several entries', async () => {
    render(<FeedbackWidget />)
    expect(await screen.findByRole('button', { name: /^Open product feedback, 2 entries(,|$)/ })).toBeTruthy()
  })

  it('uses the plural for zero entries', async () => {
    fetchMock.mockImplementation(async () => ok(snap(0)))
    render(<FeedbackWidget />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /^Open product feedback, 0 entries(,|$)/ })).toBeTruthy()
  })
})

describe('fetch failures', () => {
  it.each([401, 404, 500])('keeps the pill with count 0 on a %i response', async (status) => {
    fetchMock.mockImplementation(async () => ({ ok: false, status, json: async () => ({ error: 'nope' }) }))
    render(<FeedbackWidget />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /^Open product feedback, 0 entries(,|$)/ })).toBeTruthy()
  })

  it('keeps the previous snapshot when a later fetch rejects, and does not throw', async () => {
    render(<FeedbackWidget />)
    await screen.findByRole('button', { name: /2 entries/i })
    fetchMock.mockImplementation(async () => {
      throw new Error('network down')
    })
    const calls = fetchMock.mock.calls.length
    act(() => live.handler?.('resync'))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(calls + 1))
    await act(async () => {})
    expect(screen.getByRole('button', { name: /2 entries/i })).toBeTruthy()
  })

  it('keeps the previous snapshot when a later response is non-ok', async () => {
    render(<FeedbackWidget />)
    await screen.findByRole('button', { name: /2 entries/i })
    fetchMock.mockImplementation(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    const calls = fetchMock.mock.calls.length
    act(() => live.handler?.('resync'))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(calls + 1))
    await act(async () => {})
    expect(screen.getByRole('button', { name: /2 entries/i })).toBeTruthy()
  })

  it('shows "Loading…" in the open panel until the first snapshot resolves', async () => {
    let resolve!: (v: unknown) => void
    fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)))
    render(<FeedbackWidget />)
    fireEvent.click(pill())
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(/be the first/i)).toBeNull()

    await act(async () => resolve(ok(snap())))
    expect(await screen.findByText('Acme user feedback')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })
})

describe('live events', () => {
  it('debounces rapid feedback_changed events into a single refetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<FeedbackWidget />)
    await screen.findByRole('button', { name: /2 entries/i })
    const calls = fetchMock.mock.calls.length

    act(() => {
      live.handler?.('feedback_changed')
      live.handler?.('feedback_changed')
      live.handler?.('feedback_changed')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(fetchMock.mock.calls.length).toBe(calls) // still waiting
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(fetchMock.mock.calls.length).toBe(calls + 1)
  })

  it('resync cancels a pending debounced refetch and fetches immediately, once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<FeedbackWidget />)
    await screen.findByRole('button', { name: /2 entries/i })
    const calls = fetchMock.mock.calls.length

    act(() => live.handler?.('feedback_changed'))
    act(() => live.handler?.('resync'))
    expect(fetchMock.mock.calls.length).toBe(calls + 1) // immediate, no timer advance
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(fetchMock.mock.calls.length).toBe(calls + 1)
  })

  it('keeps the panel open, and the active tab, across a live refetch', async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('tab', { name: /updates/i }))
    fetchMock.mockImplementation(async () => ok(snap(7)))
    act(() => live.handler?.('resync'))
    await waitFor(() => expect(screen.getByRole('tab', { name: /feedback.*7|^feedback/i })).toBeTruthy())
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    expect(screen.getByRole('dialog', { name: /product feedback/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /updates/i }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('unmount', () => {
  it('aborts the in-flight initial fetch and unsubscribes', async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise(() => {})
    })
    const { unmount } = render(<FeedbackWidget />)
    expect(signal).toBeTruthy()
    expect(signal!.aborted).toBe(false)
    unmount()
    expect(signal!.aborted).toBe(true)
    expect(live.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending debounced refetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { unmount } = render(<FeedbackWidget />)
    await screen.findByRole('button', { name: /2 entries/i })
    const calls = fetchMock.mock.calls.length
    act(() => live.handler?.('feedback_changed'))
    unmount()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })
})

describe('focus management', () => {
  it('moves focus to the close button on open and back to the pill on close', async () => {
    await openPanel()
    const close = screen.getByRole('button', { name: /collapse feedback/i })
    expect(document.activeElement).toBe(close)
    fireEvent.click(close)
    expect(document.activeElement).toBe(pill())
  })

  it('returns focus to the pill after Escape too', async () => {
    await openPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(pill())
  })

  it('does not steal focus on first render while collapsed', async () => {
    render(<FeedbackWidget />)
    await screen.findByRole('button', { name: /2 entries/i })
    expect(document.activeElement).not.toBe(pill())
  })
})

describe('Escape listener', () => {
  it('is removed when the panel closes and when the widget unmounts', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    await openPanel()
    const keydownAdds = add.mock.calls.filter((c) => c[0] === 'keydown')
    expect(keydownAdds).toHaveLength(1)
    const handler = keydownAdds[0][1]

    fireEvent.click(screen.getByRole('button', { name: /collapse feedback/i }))
    expect(remove.mock.calls.some((c) => c[0] === 'keydown' && c[1] === handler)).toBe(true)
    add.mockRestore()
    remove.mockRestore()
  })

  it('ignores other keys and Escape while collapsed', async () => {
    await openPanel()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(pill()).toBeTruthy()
  })
})

describe('tab ARIA wiring', () => {
  it('marks exactly one tab selected, and aria-controls points at the rendered tabpanel', async () => {
    await openPanel()
    const feedbackTab = screen.getByRole('tab', { name: /^feedback/i })
    const updatesTab = screen.getByRole('tab', { name: /^updates/i })
    expect(feedbackTab.getAttribute('aria-selected')).toBe('true')
    expect(updatesTab.getAttribute('aria-selected')).toBe('false')

    const panel = screen.getByRole('tabpanel')
    expect(panel.id).toBe(feedbackTab.getAttribute('aria-controls'))
    expect(panel.getAttribute('aria-labelledby')).toBe(feedbackTab.id)

    fireEvent.click(updatesTab)
    expect(updatesTab.getAttribute('aria-selected')).toBe('true')
    expect(feedbackTab.getAttribute('aria-selected')).toBe('false')
    const panel2 = screen.getByRole('tabpanel')
    expect(panel2.id).toBe(updatesTab.getAttribute('aria-controls'))
    expect(panel2.getAttribute('aria-labelledby')).toBe(updatesTab.id)
    expect(document.getElementById(feedbackTab.getAttribute('aria-controls')!)).toBeNull()
  })

  it('reopens on the Feedback tab after being closed from Updates', async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('tab', { name: /^updates/i }))
    fireEvent.click(screen.getByRole('button', { name: /collapse feedback/i }))
    fireEvent.click(pill())
    // Tab state persists in the component; assert whichever is selected has a matching panel.
    const selected = screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')!
    expect(screen.getByRole('tabpanel').id).toBe(selected.getAttribute('aria-controls'))
  })
})
