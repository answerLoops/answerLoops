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
vi.mock('@/lib/actions/product-feedback', () => ({ submitProductFeedbackAction: vi.fn(), voteProductFeedbackAction: vi.fn() }))

import { FeedbackWidget } from '@/components/feedback/feedback-widget'

const fetchMock = vi.fn()
const ok = (s: BoardSnapshot) => ({ ok: true, json: async () => s })
const fail = () => ({ ok: false, json: async () => ({}) })

function newestFirst(): BoardSnapshot {
  const base = {
    authorLabel: 'Acme user feedback',
    status: 'approved' as const,
    approvedAt: '2026-10-05T15:30:00.000Z',
    mine: false,
    viewerVoted: false,
    reply: null,
  }
  return {
    approvedCount: 3,
    updates: [],
    feedback: [
      { ...base, id: 30, body: 'Newest entry', createdAt: '2026-10-07T10:00:00.000Z', voteCount: 1 },
      { ...base, id: 20, body: 'Middle entry', createdAt: '2026-10-06T10:00:00.000Z', voteCount: 5 },
      { ...base, id: 10, body: 'Oldest entry', createdAt: '2026-10-05T10:00:00.000Z', voteCount: 1 },
    ],
  }
}
function mostVoted(): BoardSnapshot {
  const s = newestFirst()
  return { ...s, feedback: [...s.feedback].sort((a, b) => b.voteCount - a.voteCount) }
}

const NEWEST = ['Newest entry', 'Middle entry', 'Oldest entry']
const VOTES = ['Middle entry', 'Newest entry', 'Oldest entry']
const bodies = () => screen.getAllByRole('listitem').map((li) => li.textContent?.match(/(Newest|Middle|Oldest) entry/)?.[0])
const urls = () => fetchMock.mock.calls.map(([url]) => String(url))
const sortButton = (name: 'Newest' | 'Most voted') => screen.getByRole('button', { name })
const pressed = (name: 'Newest' | 'Most voted') => sortButton(name).getAttribute('aria-pressed')
const VOTES_URL = '/api/product-feedback?sort=votes'
const NEWEST_URL = '/api/product-feedback'

// Per-sort switches: each response is served, failed, or thrown on demand.
const mode = { newest: 'ok' as 'ok' | 'fail' | 'throw', votes: 'ok' as 'ok' | 'fail' | 'throw' }
function serve(kind: 'ok' | 'fail' | 'throw', snapshot: BoardSnapshot) {
  if (kind === 'throw') throw new Error('offline')
  return kind === 'fail' ? fail() : ok(snapshot)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  live.handler = null
  mode.newest = 'ok'
  mode.votes = 'ok'
  fetchMock.mockImplementation(async (url: unknown) =>
    String(url).includes('sort=votes') ? serve(mode.votes, mostVoted()) : serve(mode.newest, newestFirst()),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openBoard() {
  render(<FeedbackWidget />)
  await waitFor(() => expect(screen.getByRole('button', { name: /3 entries/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /open product feedback/i }))
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
}
const resync = () =>
  act(async () => {
    live.handler?.('resync')
  })

describe('sort recovery', () => {
  it('after a failed Most voted request, clicking it again with a good response moves the highlight and the order together', async () => {
    await openBoard()
    mode.votes = 'fail'
    fireEvent.click(sortButton('Most voted'))
    await waitFor(() => expect(urls().at(-1)).toBe(VOTES_URL))
    await act(async () => {})
    expect(pressed('Newest')).toBe('true')
    expect(bodies()).toEqual(NEWEST)

    mode.votes = 'ok'
    fireEvent.click(sortButton('Most voted'))
    await waitFor(() => expect(bodies()).toEqual(VOTES))
    expect(pressed('Most voted')).toBe('true')
    expect(pressed('Newest')).toBe('false')
    expect(urls().filter((u) => u === VOTES_URL)).toHaveLength(2)
  })

  it('does not move the highlight while the Most voted request is still in flight', async () => {
    await openBoard()
    let release!: (v: unknown) => void
    fetchMock.mockImplementation(() => new Promise((r) => (release = r)))
    fireEvent.click(sortButton('Most voted'))
    await act(async () => {})
    // Neither the highlight nor the list has moved yet, and the list is not replaced by "Loading…".
    expect(pressed('Newest')).toBe('true')
    expect(pressed('Most voted')).toBe('false')
    expect(bodies()).toEqual(NEWEST)
    expect(screen.queryByText('Loading…')).toBeNull()

    await act(async () => release(ok(mostVoted())))
    await waitFor(() => expect(bodies()).toEqual(VOTES))
    expect(pressed('Most voted')).toBe('true')
  })

  it('a failed request never blanks the list or shows Loading…', async () => {
    await openBoard()
    mode.votes = 'throw'
    fireEvent.click(sortButton('Most voted'))
    await act(async () => {})
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.queryByText(/no feedback yet/i)).toBeNull()
    expect(bodies()).toEqual(NEWEST)
  })

  it('a failed Newest request while Most voted is on screen keeps both the order and the highlight', async () => {
    await openBoard()
    fireEvent.click(sortButton('Most voted'))
    await waitFor(() => expect(bodies()).toEqual(VOTES))

    mode.newest = 'fail'
    fireEvent.click(sortButton('Newest'))
    await waitFor(() => expect(urls().at(-1)).toBe(NEWEST_URL))
    await act(async () => {})
    expect(pressed('Most voted')).toBe('true')
    expect(pressed('Newest')).toBe('false')
    expect(bodies()).toEqual(VOTES)
  })

  it('after a failed Newest click, the next live load follows the last click and brings the order and highlight to Newest together', async () => {
    await openBoard()
    fireEvent.click(sortButton('Most voted'))
    await waitFor(() => expect(bodies()).toEqual(VOTES))

    mode.newest = 'throw'
    fireEvent.click(sortButton('Newest'))
    await act(async () => {})
    expect(bodies()).toEqual(VOTES)

    mode.newest = 'ok'
    await resync()
    // sortRef is the last requested sort, so the refetch asks for Newest, not Most voted.
    expect(urls().at(-1)).toBe(NEWEST_URL)
    await waitFor(() => expect(bodies()).toEqual(NEWEST))
    expect(pressed('Newest')).toBe('true')
    expect(pressed('Most voted')).toBe('false')
  })

  it('a failed Most voted request does not drop the click: later live loads keep asking for votes until one succeeds', async () => {
    await openBoard()
    mode.votes = 'fail'
    fireEvent.click(sortButton('Most voted'))
    await act(async () => {})

    await resync()
    expect(urls().at(-1)).toBe(VOTES_URL)
    expect(pressed('Newest')).toBe('true')
    expect(bodies()).toEqual(NEWEST)

    mode.votes = 'ok'
    await resync()
    await waitFor(() => expect(bodies()).toEqual(VOTES))
    expect(pressed('Most voted')).toBe('true')
  })

  it('clicking Newest after a failed Most voted request retargets live loads back to the bare path', async () => {
    await openBoard()
    mode.votes = 'fail'
    fireEvent.click(sortButton('Most voted'))
    await act(async () => {})

    fireEvent.click(sortButton('Newest'))
    await waitFor(() => expect(urls().at(-1)).toBe(NEWEST_URL))
    await resync()
    expect(urls().at(-1)).toBe(NEWEST_URL)
    expect(urls().filter((u) => u === VOTES_URL)).toHaveLength(1)
    expect(pressed('Newest')).toBe('true')
    expect(bodies()).toEqual(NEWEST)
  })

  it('a failed newer request does not stop an older, still-pending response from being dropped', async () => {
    await openBoard()
    const held: { url: string; resolve: (v: unknown) => void }[] = []
    fetchMock.mockImplementation((url: unknown) => new Promise((resolve) => held.push({ url: String(url), resolve })))
    fireEvent.click(sortButton('Most voted'))
    fireEvent.click(sortButton('Newest'))
    expect(held.map((h) => h.url)).toEqual([VOTES_URL, NEWEST_URL])

    // The newest request fails: nothing is applied.
    await act(async () => held[1].resolve(fail()))
    // The older Most voted response arrives afterwards. It is stale and must not
    // flip the list or the highlight to an order the person has since left.
    await act(async () => held[0].resolve(ok(mostVoted())))
    await act(async () => {})
    expect(bodies()).toEqual(NEWEST)
    expect(pressed('Newest')).toBe('true')
    expect(pressed('Most voted')).toBe('false')
  })
})
