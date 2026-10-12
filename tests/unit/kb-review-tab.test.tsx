// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { KBReviewItem } from '@/lib/db/queries/kb-review'

/**
 * The Review tab: what a reviewer sees for each unseen question, that edits are
 * what gets published, and how plan locks, conflicts and failures surface.
 * fetch is faked per URL/method so each test controls the queue.
 */

vi.mock('@/components/billing/locked-feature', () => ({
  LockedFeature: ({ requiredPlan, featureLabel }: { requiredPlan: string; featureLabel: string }) => (
    <div data-testid="locked">{featureLabel} needs {requiredPlan}</div>
  ),
}))

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.stubGlobal('fetch', h.fetchMock)

const item = (over: Partial<KBReviewItem> = {}): KBReviewItem => ({
  id: 1,
  source: 'widget',
  ticket_id: null,
  question: 'Do you ship to Canada?',
  answer: 'Yes, we ship to Canada.',
  confidence: null,
  occurrences: 1,
  status: 'pending',
  article_id: null,
  reviewed_at: null,
  created_at: '2026-10-01T12:00:00.000Z',
  ...over,
})

const counts = { pending: 1, approved: 0, rejected: 0 }
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

function queue(items: KBReviewItem[], patch?: () => Promise<Response>) {
  h.fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return patch ? patch() : json({ ok: true })
    return json({ items, counts })
  })
}

async function renderTab(onCountsChange?: (c: typeof counts) => void) {
  const { ReviewTab } = await import('@/app/(dashboard)/kb/review-tab')
  return render(<ReviewTab onCountsChange={onCountsChange} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReviewTab', () => {
  it('shows each pending question with its source and an editable answer, and reports counts', async () => {
    queue([item({ occurrences: 4 })])
    const onCounts = vi.fn()
    await renderTab(onCounts)
    expect(await screen.findByDisplayValue('Do you ship to Canada?')).toBeTruthy()
    expect(screen.getByDisplayValue('Yes, we ship to Canada.')).toBeTruthy()
    expect(screen.getByText('Chat widget')).toBeTruthy()
    expect(screen.getByText('Asked 4 times')).toBeTruthy()
    expect(onCounts).toHaveBeenCalledWith(counts)
    expect(h.fetchMock.mock.calls[0][0]).toBe('/api/kb/review?status=pending')
  })

  it('flags an item with no usable answer and keeps Approve disabled until one is written', async () => {
    const user = userEvent.setup()
    queue([item({ answer: '' })])
    await renderTab()
    expect(await screen.findByText('No usable answer — write one')).toBeTruthy()
    const approve = screen.getByRole('button', { name: /approve and add/i }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    await user.type(screen.getByLabelText(/^answer/i), 'We ship to Canada and the US.')
    expect(approve.disabled).toBe(false)
  })

  it('approves with the EDITED question and answer, then reloads the queue', async () => {
    const user = userEvent.setup()
    queue([item()])
    await renderTab()
    const answer = await screen.findByLabelText(/^answer/i)
    await user.clear(answer)
    await user.type(answer, 'We ship to Canada within 5 days.')
    await user.click(screen.getByRole('button', { name: /approve and add/i }))

    await waitFor(() => {
      const patch = h.fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(patch?.[0]).toBe('/api/kb/review/1')
      expect(JSON.parse(patch?.[1].body)).toEqual({
        action: 'approve',
        question: 'Do you ship to Canada?',
        answer: 'We ship to Canada within 5 days.',
      })
    })
    // initial load + reload after the action
    await waitFor(() => expect(h.fetchMock.mock.calls.filter(([, init]) => !init?.method).length).toBe(2))
  })

  it('rejects without sending any text', async () => {
    const user = userEvent.setup()
    queue([item()])
    await renderTab()
    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => {
      const patch = h.fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(JSON.parse(patch?.[1].body)).toEqual({ action: 'reject' })
    })
  })

  it('shows the server error and keeps the item when approval fails', async () => {
    const user = userEvent.setup()
    queue([item()], () => json({ error: 'Knowledge base is full (2000 articles).' }, 400))
    await renderTab()
    await user.click(await screen.findByRole('button', { name: /approve and add/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('Knowledge base is full')
    expect(screen.getByDisplayValue('Do you ship to Canada?')).toBeTruthy()
    expect(h.fetchMock.mock.calls.filter(([, init]) => !init?.method).length).toBe(1)
  })

  it('shows the message and reloads when someone else already reviewed the item', async () => {
    const user = userEvent.setup()
    queue([item()], () => json({ error: 'This item was already reviewed' }, 409))
    await renderTab()
    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    expect((await screen.findByRole('alert')).textContent).toContain('already reviewed')
    await waitFor(() => expect(h.fetchMock.mock.calls.filter(([, init]) => !init?.method).length).toBe(2))
  })

  it('swaps the list when the status tab changes and offers reopen on rejected items', async () => {
    const user = userEvent.setup()
    h.fetchMock.mockImplementation((url: string) =>
      url.includes('status=rejected')
        ? json({ items: [item({ id: 9, status: 'rejected', question: 'Old question' })], counts: { pending: 0, approved: 0, rejected: 1 } })
        : json({ items: [], counts })
    )
    await renderTab()
    expect(await screen.findByText('Nothing to review right now.')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: /rejected/i }))
    expect(await screen.findByText('Old question')).toBeTruthy()
    expect(screen.getByRole('button', { name: /move back to review/i })).toBeTruthy()
  })

  it('shows an approved item as published with no actions', async () => {
    const user = userEvent.setup()
    h.fetchMock.mockImplementation((url: string) =>
      url.includes('status=approved')
        ? json({ items: [item({ status: 'approved', article_id: 3 })], counts })
        : json({ items: [], counts })
    )
    await renderTab()
    await user.click(await screen.findByRole('tab', { name: /approved/i }))
    expect(await screen.findByText('Published to the knowledge base.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /approve and add/i })).toBeNull()
  })

  it('shows the upgrade prompt, not the queue, when the plan lacks the feature', async () => {
    h.fetchMock.mockImplementation(() => json({ error: 'nope', locked: true, requiredPlan: 'pro' }, 402))
    await renderTab()
    expect((await screen.findByTestId('locked')).textContent).toContain('needs pro')
  })

  it('shows an error when the queue cannot be loaded', async () => {
    h.fetchMock.mockImplementation(() => json({ error: 'Internal server error' }, 500))
    await renderTab()
    expect((await screen.findByRole('alert')).textContent).toContain('Internal server error')
  })
})
