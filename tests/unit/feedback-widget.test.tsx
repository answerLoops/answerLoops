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

const actions = vi.hoisted(() => ({
  submitProductFeedbackAction: vi.fn(),
  moderateProductFeedbackAction: vi.fn(),
  replyToProductFeedbackAction: vi.fn(),
  deleteProductFeedbackAction: vi.fn(),
  publishProductUpdateAction: vi.fn(),
  deleteProductUpdateAction: vi.fn(),
}))
vi.mock('@/lib/actions/product-feedback', () => actions)

import { FeedbackWidget } from '@/components/feedback/feedback-widget'

const GOOD = 'The new dashboard is great and saves our team a lot of time.'

function snapshot(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    approvedCount: 2,
    feedback: [
      {
        id: 1,
        authorLabel: 'Acme user feedback',
        body: 'Nice tool, the replies feel natural.',
        status: 'approved',
        createdAt: '2026-10-05T15:04:00.000Z',
        approvedAt: '2026-10-05T15:30:00.000Z',
        mine: false,
        reply: { body: 'Thanks for the kind words!', tag: 'great_feedback', repliedAt: '2026-10-05T16:00:00.000Z' },
      },
    ],
    updates: [{ id: 3, title: 'Faster KB sync', body: 'Syncs now run in the background.', publishedAt: '2026-10-06T10:00:00.000Z' }],
    ...overrides,
  }
}

let current: BoardSnapshot
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  live.handler = null
  current = snapshot()
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => current }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function renderCollapsed() {
  render(<FeedbackWidget />)
  await waitFor(() => expect(screen.getByRole('button', { name: /open product feedback/i })).toBeTruthy())
  await waitFor(() => expect(screen.getByRole('button', { name: /2 entries/i })).toBeTruthy())
}

async function open() {
  await renderCollapsed()
  fireEvent.click(screen.getByRole('button', { name: /open product feedback/i }))
  return screen.getByRole('dialog', { name: /product feedback/i })
}

describe('collapsed pill', () => {
  it('shows the approved count and opens the panel on click', async () => {
    await renderCollapsed()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /open product feedback/i }))
    expect(screen.getByRole('dialog', { name: /product feedback/i })).toBeTruthy()
    expect(screen.getByText('Product Feedback')).toBeTruthy()
  })

  it('updates the count live when the stream signals feedback_changed, without opening', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderCollapsed()

    current = snapshot({ approvedCount: 3 })
    act(() => live.handler?.('feedback_changed'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /3 entries/i })).toBeTruthy())
  })

  it('refetches immediately on resync (events may have been missed)', async () => {
    await renderCollapsed()
    const calls = fetchMock.mock.calls.length
    current = snapshot({ approvedCount: 5 })
    act(() => live.handler?.('resync'))
    await waitFor(() => expect(screen.getByRole('button', { name: /5 entries/i })).toBeTruthy())
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls)
  })

  it('unsubscribes from the live stream on unmount', async () => {
    const { unmount } = render(<FeedbackWidget />)
    unmount()
    expect(live.unsubscribe).toHaveBeenCalled()
  })
})

describe('expanded panel', () => {
  it('renders feedback with the owner reply and tag, and switches to Updates', async () => {
    await open()
    expect(screen.getByText('Acme user feedback')).toBeTruthy()
    expect(screen.getByText('Nice tool, the replies feel natural.')).toBeTruthy()
    expect(screen.getByText('Thanks for the kind words!')).toBeTruthy()
    expect(screen.getByText('Great feedback')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /updates/i }))
    expect(screen.getByText('Faster KB sync')).toBeTruthy()
    expect(screen.queryByText('Acme user feedback')).toBeNull()
  })

  it('collapses with the close button and with Escape', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /collapse feedback/i }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /open product feedback/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not show moderation or publish controls to regular users', async () => {
    await open()
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /updates/i }))
    expect(screen.queryByText(/post an update/i)).toBeNull()
  })

  it('shows empty states', async () => {
    current = snapshot({ approvedCount: 0, feedback: [], updates: [] })
    render(<FeedbackWidget />)
    fireEvent.click(await screen.findByRole('button', { name: /open product feedback/i }))
    expect(await screen.findByText(/be the first/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /updates/i }))
    expect(screen.getByText(/no updates yet/i)).toBeTruthy()
  })
})

describe('composer', () => {
  async function openComposer() {
    await open()
    return {
      textarea: screen.getByPlaceholderText(/leave answerloops some feedback/i) as HTMLTextAreaElement,
      submit: screen.getByRole('button', { name: /^submit$/i }) as HTMLButtonElement,
    }
  }

  it('keeps Submit disabled until the text is valid', async () => {
    const { textarea, submit } = await openComposer()
    expect(submit.disabled).toBe(true)

    fireEvent.change(textarea, { target: { value: 'too short' } })
    expect(submit.disabled).toBe(true)

    fireEvent.change(textarea, { target: { value: GOOD } })
    expect(submit.disabled).toBe(false)
  })

  it('has no vote controls', async () => {
    await openComposer()
    expect(screen.queryByRole('button', { name: /up-vote|down-vote/i })).toBeNull()
  })

  it('blocks links client-side', async () => {
    const { textarea, submit } = await openComposer()
    fireEvent.change(textarea, { target: { value: `${GOOD} see https://spam.example` } })
    expect(submit.disabled).toBe(true)
  })

  it('submits, clears the form and tells the user it awaits review', async () => {
    actions.submitProductFeedbackAction.mockResolvedValue({ ok: true })
    const { textarea, submit } = await openComposer()
    fireEvent.click(screen.getByLabelText(/post anonymously/i))
    fireEvent.change(textarea, { target: { value: GOOD } })
    fireEvent.click(submit)

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/awaiting review/i))
    expect(actions.submitProductFeedbackAction).toHaveBeenCalledWith({ body: GOOD, anonymous: true })
    expect(textarea.value).toBe('')
    expect(submit.disabled).toBe(true)
  })

  it('shows a server error and keeps the draft', async () => {
    actions.submitProductFeedbackAction.mockResolvedValue({ ok: false, error: 'Please try again later.' })
    const { textarea, submit } = await openComposer()
    fireEvent.change(textarea, { target: { value: GOOD } })
    fireEvent.click(submit)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/try again later/i))
    expect(textarea.value).toBe(GOOD)
  })
})

describe('new update dot', () => {
  const dot = () => screen.queryByTestId('new-update-dot')

  it('shows on the collapsed pill when there is an update the user has not seen', async () => {
    await renderCollapsed()
    await waitFor(() => expect(dot()).toBeTruthy())
    expect(screen.getByRole('button', { name: /new update/i })).toBeTruthy()
  })

  it('clears once the Updates tab is viewed, and stays cleared after a remount', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('new-update-tab-dot')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /updates/i }))
    await waitFor(() => expect(screen.queryByTestId('new-update-tab-dot')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /collapse feedback/i }))
    expect(dot()).toBeNull()

    cleanup()
    render(<FeedbackWidget />)
    await waitFor(() => expect(screen.getByRole('button', { name: /open product feedback/i })).toBeTruthy())
    expect(dot()).toBeNull()
  })

  it('does not show when the newest update was already seen', async () => {
    window.localStorage.setItem('answerloops:feedback:last-seen-update', '3')
    await renderCollapsed()
    expect(dot()).toBeNull()
  })

  it('does not show when there are no updates', async () => {
    current = snapshot({ updates: [] })
    render(<FeedbackWidget />)
    await waitFor(() => expect(screen.getByRole('button', { name: /open product feedback/i })).toBeTruthy())
    expect(dot()).toBeNull()
  })

  it('reappears when a newer update is posted live', async () => {
    window.localStorage.setItem('answerloops:feedback:last-seen-update', '3')
    await renderCollapsed()
    expect(dot()).toBeNull()

    current = snapshot({
      updates: [
        { id: 4, title: 'Dark mode', body: 'It is here.', publishedAt: '2026-10-08T10:00:00.000Z' },
        ...snapshot().updates,
      ],
    })
    act(() => live.handler?.('resync'))
    await waitFor(() => expect(dot()).toBeTruthy())
  })

  it('does not flag an update that arrives while the Updates tab is open', async () => {
    await open()
    fireEvent.click(screen.getByRole('tab', { name: /updates/i }))
    current = snapshot({
      updates: [{ id: 9, title: 'Live', body: 'Posted now.', publishedAt: '2026-10-08T10:00:00.000Z' }],
    })
    act(() => live.handler?.('resync'))
    await waitFor(() => expect(screen.getByText('Live')).toBeTruthy())
    await waitFor(() =>
      expect(window.localStorage.getItem('answerloops:feedback:last-seen-update')).toBe('9'),
    )
    expect(screen.queryByTestId('new-update-tab-dot')).toBeNull()
  })

  it('still works when storage throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await renderCollapsed()
    await waitFor(() => expect(dot()).toBeTruthy())
    spy.mockRestore()
  })
})

describe('no usage tracking', () => {
  const urls = () => fetchMock.mock.calls.map(([url]) => String(url))

  it('only ever fetches the feedback snapshot — nothing is reported about how the widget is used', async () => {
    await open()
    fireEvent.click(screen.getByRole('tab', { name: /updates/i }))
    fireEvent.click(screen.getByRole('tab', { name: /feedback/i }))
    fireEvent.click(screen.getByRole('button', { name: /collapse feedback/i }))
    expect(urls().length).toBeGreaterThan(0)
    expect(urls().every((u) => u === '/api/product-feedback')).toBe(true)
  })

  it('sends nothing on a timer, on tab visibility changes, or on page hide', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderCollapsed()
    const before = urls().length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000)
    })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
    })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    expect(urls().length).toBe(before)
  })

  it('keeps nothing about the visit on the server: only a last-seen update id in this browser', async () => {
    await open()
    fireEvent.click(screen.getByRole('tab', { name: /updates/i }))
    const keys = Object.keys(window.localStorage).concat(Object.keys(window.sessionStorage))
    expect(keys).toEqual(['answerloops:feedback:last-seen-update'])
  })
})
