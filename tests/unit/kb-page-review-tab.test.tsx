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
  onAdded: { current: null as null | (() => void) },
  draft: { current: null as unknown },
  onDraftConsumed: { current: null as null | (() => void) },
  getTicketDraftAction: vi.fn(),
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
vi.mock('@/components/dashboard/add-knowledge-section', () => ({
  AddKnowledgeSection: (props: { onAdded?: () => void; draft?: unknown; onDraftConsumed?: () => void }) => {
    h.onAdded.current = props.onAdded ?? null
    h.draft.current = props.draft ?? null
    h.onDraftConsumed.current = props.onDraftConsumed ?? null
    return <div data-testid="add-knowledge-section" />
  },
}))
vi.mock('@/lib/actions/kb', () => ({ getTicketDraftAction: h.getTicketDraftAction }))
vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: vi.fn() }))
vi.mock('@/lib/kb/sync-client', () => ({ runKbSync: vi.fn() }))

vi.stubGlobal('fetch', h.fetchMock)

function json(body: unknown, ok = true, status = ok ? 200 : 402) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response)
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
  h.onAdded.current = null
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

  it('shows no badge when the member is not allowed to see the queue (403)', async () => {
    route(() => json({ error: 'forbidden', counts: { pending: 9 } }, false, 403))
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

describe('KB page: add-knowledge form', () => {
  it('shows the form on the Manage tab', async () => {
    await renderPage()
    expect(screen.getByTestId('add-knowledge-section')).toBeTruthy()
  })

  it('hides the form on the Review and Coverage tabs', async () => {
    await renderPage('tab=review')
    expect(screen.queryByTestId('add-knowledge-section')).toBeNull()
    cleanup()
    await renderPage('tab=coverage')
    expect(screen.queryByTestId('add-knowledge-section')).toBeNull()
  })

  it('reloads the article list after an article is added', async () => {
    await renderPage()
    const listCalls = () => h.fetchMock.mock.calls.filter(([url]) => url === '/api/kb').length
    const before = listCalls()
    expect(h.onAdded.current).toBeTypeOf('function')
    await act(async () => {
      h.onAdded.current?.()
    })
    await waitFor(() => expect(listCalls()).toBe(before + 1))
  })
})

describe('KB page: starting an article from a ticket (?sourceTicket)', () => {
  it('loads the ticket text and hands it to the form', async () => {
    h.getTicketDraftAction.mockResolvedValue({ ok: true, ticketId: 12, question: 'Q', answer: 'A' })
    await renderPage('sourceTicket=12')
    await waitFor(() => expect(h.draft.current).toEqual({ ticketId: 12, question: 'Q', answer: 'A' }))
    expect(h.getTicketDraftAction).toHaveBeenCalledWith(12)
  })

  it('does not call the server for a value that is not a positive integer', async () => {
    for (const bad of ['abc', '0', '-1', '-2', '1.5', '12abc', '99999999999', '']) {
      cleanup()
      h.getTicketDraftAction.mockClear()
      await renderPage(`sourceTicket=${encodeURIComponent(bad)}`)
      expect(h.getTicketDraftAction).not.toHaveBeenCalled()
      expect(await screen.findByRole('alert')).toBeTruthy()
    }
  })

  it('shows the refusal when the ticket cannot be used', async () => {
    h.getTicketDraftAction.mockResolvedValue({ ok: false, error: 'Ticket not found' })
    await renderPage('sourceTicket=99')
    expect((await screen.findByRole('alert')).textContent).toBe('Ticket not found')
    expect(h.draft.current).toBeNull()
  })

  it('drops the param once the drafted article is saved', async () => {
    h.getTicketDraftAction.mockResolvedValue({ ok: true, ticketId: 12, question: 'Q', answer: 'A' })
    await renderPage('sourceTicket=12&foo=bar')
    await waitFor(() => expect(h.draft.current).not.toBeNull())
    await act(async () => {
      h.onDraftConsumed.current?.()
    })
    expect(h.replace).toHaveBeenCalledWith('/kb?foo=bar', { scroll: false })
  })

  it('asks the server exactly once for a valid id and shows no alert', async () => {
    h.getTicketDraftAction.mockResolvedValue({ ok: true, ticketId: 7, question: 'Q', answer: 'A' })
    await renderPage('sourceTicket=7')
    await waitFor(() => expect(h.draft.current).not.toBeNull())
    expect(h.getTicketDraftAction).toHaveBeenCalledTimes(1)
    expect(h.getTicketDraftAction).toHaveBeenCalledWith(7)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('makes no ticket request and shows no alert when the param is absent', async () => {
    await renderPage('')
    expect(h.getTicketDraftAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(h.draft.current).toBeNull()
  })

  it('shows an inline alert and no prefill when loading the ticket throws', async () => {
    h.getTicketDraftAction.mockRejectedValue(new Error('boom'))
    await renderPage('sourceTicket=12')
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load that ticket/i)
    expect(h.draft.current).toBeNull()
  })

  it('does not clear the param when nothing was consumed', async () => {
    h.getTicketDraftAction.mockResolvedValue({ ok: false, error: 'Not allowed' })
    await renderPage('sourceTicket=12')
    await screen.findByRole('alert')
    expect(h.replace).not.toHaveBeenCalled()
  })
})

describe('KB page: deleting articles and sources', () => {
  const article = (id: number) => ({
    id, question: `Question ${id}`, answer: `Answer ${id}`, source_ticket_number: null,
    published: 1, source_id: null, source_page: null, source_ticket_id: null, created_at: '', updated_at: '',
  })
  const source = (id: number) => ({
    id, filename: `file-${id}.pdf`, file_type: 'pdf', chunk_count: 4, created_at: '2026-01-01',
  })

  function routeWithContent(deleteStatus: (url: string) => number) {
    h.fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        const status = deleteStatus(url)
        return json({}, status >= 200 && status < 300, status)
      }
      if (url === '/api/kb/review?limit=0') return json({ counts: { pending: 0 } })
      if (url === '/api/kb') return json([article(1), article(2)])
      if (url === '/api/kb/sources') return json([source(10), source(11)])
      return json({})
    })
  }

  const deleteCalls = () => h.fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
  const listCalls = () => h.fetchMock.mock.calls.filter(([url]) => url === '/api/kb').length

  async function bulkDeleteArticles() {
    await renderPage()
    await screen.findByText('Question 1')
    const box = screen.getAllByRole('checkbox')
    // First checkbox in the page is the sources "select all"; articles come after.
    const articleBoxes = box.slice(box.length - 3)
    await userEvent.click(articleBoxes[0])
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete selected' }).pop()!)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  }

  it('shows the owner/admin message on 403 and keeps the articles', async () => {
    routeWithContent(() => 403)
    await bulkDeleteArticles()
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only workspace owners and admins can delete knowledge base content.'
    )
    expect(screen.getByText('Question 1')).toBeTruthy()
    expect(screen.getByText('Question 2')).toBeTruthy()
    expect(deleteCalls().length).toBe(2)
  })

  it('does not reload the list when nothing was deleted', async () => {
    routeWithContent(() => 403)
    await renderPage()
    await screen.findByText('Question 1')
    const before = listCalls()
    const box = screen.getAllByRole('checkbox')
    await userEvent.click(box[box.length - 3])
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete selected' }).pop()!)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByRole('alert')
    expect(listCalls()).toBe(before)
  })

  it('shows a generic message on other failures', async () => {
    routeWithContent(() => 500)
    await bulkDeleteArticles()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Could not delete/)
    expect(alert.textContent).not.toMatch(/owners and admins/)
  })

  it('reports partial success accurately and reloads', async () => {
    routeWithContent((url) => (url.endsWith('/1') ? 204 : 500))
    await renderPage()
    await screen.findByText('Question 1')
    const before = listCalls()
    const box = screen.getAllByRole('checkbox')
    await userEvent.click(box[box.length - 3]) // select all articles
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete selected' }).pop()!)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/^Deleted 1 of 2 articles\./)
    await waitFor(() => expect(listCalls()).toBe(before + 1))
  })

  it('shows the owner/admin message when bulk deleting sources is refused', async () => {
    routeWithContent(() => 403)
    await renderPage()
    await screen.findByText('file-10.pdf')
    await userEvent.click(screen.getAllByRole('checkbox')[0])
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete selected' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only workspace owners and admins can delete knowledge base content.'
    )
    expect(screen.getByText('file-10.pdf')).toBeTruthy()
    expect(screen.getByText('file-11.pdf')).toBeTruthy()
  })
})
