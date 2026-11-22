// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The KB page's Flagged answers tab: its open-count badge, tab selection from
 * the URL, and the URL written on a click. Tab bodies are stubbed; the flags
 * tab's own behavior is covered in kb-flags-tab.test.tsx.
 */

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  replace: vi.fn(),
  params: { current: new URLSearchParams() },
  onCountsChange: { current: null as null | ((c: { open: number }) => void) },
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => h.params.current,
  useRouter: () => ({ replace: h.replace }),
}))
vi.mock('@/app/(dashboard)/kb/review-tab', () => ({ ReviewTab: () => <div data-testid="review-tab" /> }))
vi.mock('@/app/(dashboard)/kb/coverage-tab', () => ({ CoverageTab: () => <div data-testid="coverage-tab" /> }))
vi.mock('@/app/(dashboard)/kb/flags-tab', () => ({
  FlagsTab: (props: { onCountsChange?: (c: { open: number }) => void }) => {
    h.onCountsChange.current = props.onCountsChange ?? null
    return <div data-testid="flags-tab" />
  },
}))
vi.mock('@/components/dashboard/notion-kb-section', () => ({ NotionKBSection: () => <div /> }))
vi.mock('@/components/dashboard/add-knowledge-section', () => ({ AddKnowledgeSection: () => <div /> }))
vi.mock('@/lib/actions/kb', () => ({ getTicketDraftAction: vi.fn() }))
vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: vi.fn() }))
vi.mock('@/lib/kb/sync-client', () => ({ runKbSync: vi.fn() }))

vi.stubGlobal('fetch', h.fetchMock)

const json = (body: unknown, ok = true, status = ok ? 200 : 402) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response)

function route(flags: () => Promise<Response>) {
  h.fetchMock.mockImplementation((url: string) => {
    if (url === '/api/kb/flags?limit=0') return flags()
    if (url === '/api/kb/review?limit=0') return json({ counts: { pending: 0 } })
    if (url === '/api/kb' || url === '/api/kb/sources') return json([])
    return json({})
  })
}

async function renderPage(search = '') {
  h.params.current = new URLSearchParams(search)
  const { default: KBPage } = await import('@/app/(dashboard)/kb/page')
  const view = render(<KBPage />)
  await waitFor(() => expect(h.fetchMock).toHaveBeenCalledWith('/api/kb/flags?limit=0'))
  await act(async () => {})
  return view
}

const tab = (name: RegExp | string) => screen.getByRole('tab', { name })

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  h.onCountsChange.current = null
  route(() => json({ counts: { open: 0, resolved: 0, dismissed: 0 } }))
})

describe('KB page: Flagged answers tab', () => {
  it('has the tab, and shows its body for ?tab=flags', async () => {
    await renderPage('tab=flags')
    expect(tab('Flagged answers').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('flags-tab')).toBeTruthy()
    expect(screen.queryByTestId('review-tab')).toBeNull()
  })

  it('does not show it by default', async () => {
    await renderPage('')
    expect(tab('Manage').getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('flags-tab')).toBeNull()
  })

  it('writes ?tab=flags to the URL when the tab is clicked', async () => {
    await renderPage('')
    await userEvent.setup().click(tab('Flagged answers'))
    expect(h.replace).toHaveBeenCalledWith('/kb?tab=flags', { scroll: false })
  })

  it('shows the open count as a badge when there are open flags', async () => {
    route(() => json({ counts: { open: 4, resolved: 9, dismissed: 1 } }))
    await renderPage('')
    await waitFor(() => expect(tab(/^Flagged answers\s*4$/)).toBeTruthy())
  })

  it('shows no badge when nothing is open', async () => {
    route(() => json({ counts: { open: 0, resolved: 3, dismissed: 0 } }))
    await renderPage('')
    expect(tab('Flagged answers')).toBeTruthy()
  })

  it('shows no badge on a plan without it, where the count request is refused', async () => {
    route(() => json({ locked: true }, false, 402))
    await renderPage('')
    expect(tab('Flagged answers')).toBeTruthy()
  })

  it('keeps no badge when the count request fails', async () => {
    route(() => Promise.reject(new TypeError('Failed to fetch')))
    await renderPage('')
    expect(tab('Flagged answers')).toBeTruthy()
  })

  it('updates the badge when the tab reports new counts', async () => {
    await renderPage('tab=flags')
    act(() => h.onCountsChange.current?.({ open: 2 }))
    await waitFor(() => expect(tab(/^Flagged answers\s*2$/)).toBeTruthy())
    act(() => h.onCountsChange.current?.({ open: 0 }))
    await waitFor(() => expect(tab('Flagged answers')).toBeTruthy())
  })
})
