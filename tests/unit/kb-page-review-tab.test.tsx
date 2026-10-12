// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The KB page's tab bar: the Review tab, its pending-count badge, tab selection
 * from the URL, and the URL written on tab clicks. The tab bodies are stubbed;
 * their own behavior is covered in the coverage/review tab tests.
 */

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  replace: vi.fn(),
  params: { current: new URLSearchParams() },
  onCountsChange: { current: null as null | ((c: { pending: number }) => void) },
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => h.params.current,
  useRouter: () => ({ replace: h.replace }),
}))
vi.mock('@/app/(dashboard)/kb/review-tab', () => ({
  ReviewTab: (props: { onCountsChange?: (c: { pending: number }) => void }) => {
    h.onCountsChange.current = props.onCountsChange ?? null
    return <div data-testid="review-tab" />
  },
}))
vi.mock('@/app/(dashboard)/kb/coverage-tab', () => ({
  CoverageTab: () => <div data-testid="coverage-tab" />,
}))
vi.mock('@/components/dashboard/notion-kb-section', () => ({
  NotionKBSection: () => <div data-testid="notion-section" />,
}))
vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: vi.fn() }))
vi.mock('@/lib/kb/sync-client', () => ({ runKbSync: vi.fn() }))

vi.stubGlobal('fetch', h.fetchMock)

function json(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 402, json: () => Promise.resolve(body) } as Response)
}

function route(review: () => Promise<Response>) {
  h.fetchMock.mockImplementation((url: string) => {
    if (url === '/api/kb/review?limit=0') return review()
    if (url === '/api/kb' || url === '/api/kb/sources') return json([])
    return json({})
  })
}

async function renderPage(search = '') {
  h.params.current = new URLSearchParams(search)
  const { default: KBPage } = await import('@/app/(dashboard)/kb/page')
  const view = render(<KBPage />)
  // Let the mount-time fetches settle.
  await waitFor(() => expect(h.fetchMock).toHaveBeenCalledWith('/api/kb/review?limit=0'))
  await act(async () => {})
  return view
}

const tab = (name: RegExp | string) => screen.getByRole('tab', { name })

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  h.onCountsChange.current = null
  route(() => json({ counts: { pending: 0 } }))
})

describe('KB page: tab selection from the URL', () => {
  it('defaults to Manage with no tab param', async () => {
    await renderPage('')
    expect(tab('Manage').getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('review-tab')).toBeNull()
    expect(screen.queryByTestId('coverage-tab')).toBeNull()
  })

  it('falls back to Manage for an unknown tab value', async () => {
    await renderPage('tab=bogus')
    expect(tab('Manage').getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('review-tab')).toBeNull()
  })

  it('shows the coverage tab for ?tab=coverage', async () => {
    await renderPage('tab=coverage')
    expect(tab('Knowledge coverage').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('coverage-tab')).toBeTruthy()
    expect(screen.queryByTestId('review-tab')).toBeNull()
  })

  it('shows the review tab for ?tab=review', async () => {
    await renderPage('tab=review')
    expect(tab('Review').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('review-tab')).toBeTruthy()
    expect(screen.queryByTestId('coverage-tab')).toBeNull()
  })
})

describe('KB page: pending review badge', () => {
  it('shows the pending count on the Review tab when there are pending items', async () => {
    route(() => json({ counts: { pending: 7 } }))
    await renderPage('')
    await waitFor(() => expect(tab(/^Review\s*7$/)).toBeTruthy())
  })

  it('shows no badge when nothing is pending', async () => {
    route(() => json({ counts: { pending: 0 } }))
    await renderPage('')
    expect(tab('Review').textContent).toBe('Review')
  })

  it('shows no badge when the request is not ok (e.g. plan without the feature)', async () => {
    route(() => json({ error: 'upgrade' }, false))
    await renderPage('')
    expect(tab('Review').textContent).toBe('Review')
  })

  it('shows no badge, and does not crash, when the request rejects', async () => {
    route(() => Promise.reject(new Error('network')))
    await renderPage('')
    expect(tab('Review').textContent).toBe('Review')
    expect(tab('Manage')).toBeTruthy()
  })

  it('shows no badge when the response has no counts', async () => {
    route(() => json({ items: [] }))
    await renderPage('')
    expect(tab('Review').textContent).toBe('Review')
  })

  it('updates the badge when the review tab reports new counts', async () => {
    route(() => json({ counts: { pending: 3 } }))
    await renderPage('tab=review')
    await waitFor(() => expect(tab(/^Review\s*3$/)).toBeTruthy())

    act(() => h.onCountsChange.current!({ pending: 1 }))
    expect(tab(/^Review\s*1$/)).toBeTruthy()

    act(() => h.onCountsChange.current!({ pending: 0 }))
    expect(tab('Review').textContent).toBe('Review')
  })

  it('shows a badge from the tab callback even if the initial fetch gave none', async () => {
    route(() => json({ error: 'nope' }, false))
    await renderPage('tab=review')
    act(() => h.onCountsChange.current!({ pending: 4 }))
    expect(tab(/^Review\s*4$/)).toBeTruthy()
  })
})

describe('KB page: clicking tabs updates the URL', () => {
  it('goes to /kb?tab=review when Review is clicked', async () => {
    await renderPage('')
    await userEvent.click(tab('Review'))
    expect(h.replace).toHaveBeenCalledWith('/kb?tab=review', { scroll: false })
  })

  it('goes to /kb?tab=coverage when Knowledge coverage is clicked', async () => {
    await renderPage('')
    await userEvent.click(tab('Knowledge coverage'))
    expect(h.replace).toHaveBeenCalledWith('/kb?tab=coverage', { scroll: false })
  })

  it('removes the tab param, keeping others, when Manage is clicked', async () => {
    await renderPage('tab=review&foo=bar')
    await userEvent.click(tab('Manage'))
    expect(h.replace).toHaveBeenCalledWith('/kb?foo=bar', { scroll: false })
  })

  it('goes to bare /kb when Manage is clicked and no other params exist', async () => {
    await renderPage('tab=review')
    await userEvent.click(tab('Manage'))
    expect(h.replace).toHaveBeenCalledWith('/kb', { scroll: false })
  })

  it('preserves other params when switching to Review', async () => {
    await renderPage('foo=bar')
    await userEvent.click(tab('Review'))
    expect(h.replace).toHaveBeenCalledWith('/kb?foo=bar&tab=review', { scroll: false })
  })
})
