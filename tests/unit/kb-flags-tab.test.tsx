// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnswerFlag } from '@/lib/db/queries/widget-answer-flags'

/**
 * The Flagged answers tab: what an owner or admin sees for each flag, that flags
 * are grouped by the article they cited, and how acting on one, plan locks,
 * conflicts and failures surface. fetch is faked per URL/method.
 */

vi.mock('@/components/billing/locked-feature', () => ({
  LockedFeature: ({ requiredPlan, featureLabel }: { requiredPlan: string; featureLabel: string }) => (
    <div data-testid="locked">{featureLabel} needs {requiredPlan}</div>
  ),
}))

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.stubGlobal('fetch', h.fetchMock)

const EXPORT = { id: 4, question: 'How do I export?' }
const PRICING = { id: 9, question: 'What does it cost?' }

const flag = (over: Partial<AnswerFlag> = {}): AnswerFlag => ({
  id: 1,
  verdict: 'down',
  reason: 'outdated',
  note: null,
  question: 'How do I export my data?',
  answer: 'Open Settings and choose Export.',
  cited_articles: [EXPORT],
  lead_id: null,
  status: 'open',
  resolved_at: null,
  created_at: '2026-11-20T10:00:00.000Z',
  ...over,
})

const counts = { open: 1, resolved: 0, dismissed: 0 }
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

function queue(items: AnswerFlag[], patch?: () => Promise<Response>, c = counts) {
  h.fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return patch ? patch() : json({ ok: true })
    return json({ items, counts: c })
  })
}

async function renderTab(onCountsChange?: (c: typeof counts) => void) {
  const { FlagsTab } = await import('@/app/(dashboard)/kb/flags-tab')
  return render(<FlagsTab onCountsChange={onCountsChange} />)
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FlagsTab: what a flag shows', () => {
  it('shows the question, the reply, the reason and the cited article, and reports the counts', async () => {
    queue([flag()])
    const onCounts = vi.fn()
    await renderTab(onCounts)
    const card = await screen.findByTestId('flag-card')
    expect(within(card).getByText('How do I export my data?')).toBeTruthy()
    expect(within(card).getByText('Open Settings and choose Export.')).toBeTruthy()
    expect(within(card).getByText('Out of date')).toBeTruthy()
    expect(onCounts).toHaveBeenCalledWith(counts)
    expect(h.fetchMock.mock.calls[0][0]).toBe('/api/kb/flags?status=open')
  })

  it('links each cited article to its place in the knowledge base', async () => {
    queue([flag({ cited_articles: [EXPORT, PRICING] })])
    await renderTab()
    // A flag that cited two articles is listed under each, so it appears twice.
    const [card] = await screen.findAllByTestId('flag-card')
    expect(await screen.findAllByTestId('flag-card')).toHaveLength(2)
    expect(within(card).getByRole('link', { name: 'How do I export?' }).getAttribute('href')).toBe('/kb#article-4')
    expect(within(card).getByRole('link', { name: 'What does it cost?' }).getAttribute('href')).toBe('/kb#article-9')
  })

  it("shows the visitor's note, marked as unverified", async () => {
    queue([flag({ note: 'The price changed in May' })])
    await renderTab()
    expect(await screen.findByText('The price changed in May')).toBeTruthy()
    expect(screen.getByText(/note \(unverified\)/i)).toBeTruthy()
  })

  it('shows that the visitor left an email, linking to the Leads page', async () => {
    queue([flag({ lead_id: 5 })])
    await renderTab()
    const link = await screen.findByRole('link', { name: /left an email/i })
    expect(link.getAttribute('href')).toBe('/leads')
  })

  it('says so, instead of showing a blank, once the retention window has cleared the text', async () => {
    queue([flag({ question: '', answer: '', note: null })])
    await renderTab()
    expect(await screen.findByText(/no longer stored/i)).toBeTruthy()
  })
})

describe('FlagsTab: grouping by article', () => {
  it('groups flags under the article they cited, the most-flagged first, with a count and a link to open it', async () => {
    queue(
      [
        flag({ id: 1, cited_articles: [PRICING], question: 'Pricing q1' }),
        flag({ id: 2, cited_articles: [EXPORT], question: 'Export q1' }),
        flag({ id: 3, cited_articles: [EXPORT], question: 'Export q2' }),
      ],
      undefined,
      { open: 3, resolved: 0, dismissed: 0 }
    )
    await renderTab()
    const first = await screen.findByRole('region', { name: 'Flags citing How do I export?' })
    expect(within(first).getByText('Cited in 2 flagged answers')).toBeTruthy()
    expect(within(first).getAllByTestId('flag-card')).toHaveLength(2)
    expect(within(first).getByRole('link', { name: 'Open article' }).getAttribute('href')).toBe('/kb#article-4')
    const second = screen.getByRole('region', { name: 'Flags citing What does it cost?' })
    expect(within(second).getByText('Cited in 1 flagged answer')).toBeTruthy()
    const regions = screen.getAllByRole('region')
    expect(regions[0]).toBe(first)
  })

  it('lists flags with no cited article separately', async () => {
    queue([flag({ id: 1, cited_articles: [] })])
    await renderTab()
    const section = await screen.findByRole('region', { name: 'Flags with no cited article' })
    expect(within(section).getAllByTestId('flag-card')).toHaveLength(1)
    expect(screen.getByText('Not tied to an article')).toBeTruthy()
  })
})

describe('FlagsTab: acting on a flag', () => {
  it('marks a flag resolved and reloads the list', async () => {
    const user = userEvent.setup()
    queue([flag({ id: 7 })])
    await renderTab()
    await user.click(await screen.findByRole('button', { name: 'Mark resolved' }))
    await waitFor(() => {
      const patch = h.fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(patch?.[0]).toBe('/api/kb/flags/7')
      expect(JSON.parse(patch?.[1].body)).toEqual({ action: 'resolve' })
    })
    await waitFor(() => expect(h.fetchMock.mock.calls.filter(([, init]) => !init?.method).length).toBeGreaterThan(1))
  })

  it('dismisses a flag', async () => {
    const user = userEvent.setup()
    queue([flag({ id: 7 })])
    await renderTab()
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await waitFor(() => {
      const patch = h.fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(JSON.parse(patch?.[1].body)).toEqual({ action: 'dismiss' })
    })
  })

  it('offers Move back to review on a resolved flag, and sends reopen', async () => {
    const user = userEvent.setup()
    queue([flag({ id: 7, status: 'resolved' })], undefined, { open: 0, resolved: 1, dismissed: 0 })
    await renderTab()
    await user.click(await screen.findByRole('tab', { name: /Resolved/ }))
    await user.click(await screen.findByRole('button', { name: 'Move back to review' }))
    await waitFor(() => {
      const patch = h.fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(JSON.parse(patch?.[1].body)).toEqual({ action: 'reopen' })
    })
    expect(h.fetchMock.mock.calls.some(([url]) => url === '/api/kb/flags?status=resolved')).toBe(true)
  })

  it('offers only Move back to review on a dismissed flag', async () => {
    const user = userEvent.setup()
    queue([flag({ id: 7, status: 'dismissed', question: '', answer: '' })], undefined, { open: 0, resolved: 0, dismissed: 1 })
    await renderTab()
    await user.click(await screen.findByRole('tab', { name: /Dismissed/ }))
    expect(await screen.findByRole('button', { name: 'Move back to review' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark resolved' })).toBeNull()
  })

  it('does not send a second request while one is in flight', async () => {
    const user = userEvent.setup()
    let release: (r: Response) => void = () => {}
    queue([flag({ id: 7 })], () => new Promise<Response>((resolve) => (release = resolve)))
    await renderTab()
    const resolveBtn = await screen.findByRole('button', { name: 'Mark resolved' })
    await user.click(resolveBtn)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(h.fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    release(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })

  it('shows the error and keeps the flag when the change fails', async () => {
    const user = userEvent.setup()
    queue([flag({ id: 7 })], () => json({ error: 'Internal server error' }, 500))
    await renderTab()
    await user.click(await screen.findByRole('button', { name: 'Mark resolved' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/internal server error/i)
    expect(screen.getByTestId('flag-card')).toBeTruthy()
  })

  it('shows what happened and reloads when someone else already handled the flag', async () => {
    const user = userEvent.setup()
    queue([flag({ id: 7 })], () => json({ error: 'This flag was already handled' }, 409))
    await renderTab()
    await user.click(await screen.findByRole('button', { name: 'Mark resolved' }))
    await waitFor(() => expect(h.fetchMock.mock.calls.filter(([, init]) => !init?.method).length).toBeGreaterThan(1))
  })

  it('shows a connection message when the request itself fails', async () => {
    const user = userEvent.setup()
    queue([flag({ id: 7 })], () => Promise.reject(new TypeError('Failed to fetch')))
    await renderTab()
    await user.click(await screen.findByRole('button', { name: 'Mark resolved' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/check your connection/i)
  })
})

describe('FlagsTab: states', () => {
  it('shows the status tabs with their counts and loads the one picked', async () => {
    const user = userEvent.setup()
    queue([], undefined, { open: 3, resolved: 2, dismissed: 1 })
    await renderTab()
    expect(await screen.findByRole('tab', { name: /To review\s*3/ })).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: /Dismissed\s*1/ }))
    await waitFor(() => expect(h.fetchMock.mock.calls.some(([url]) => url === '/api/kb/flags?status=dismissed')).toBe(true))
  })

  it('explains how flags are made when there are none', async () => {
    queue([])
    await renderTab()
    expect(await screen.findByText(/thumbs-down under a chat answer/i)).toBeTruthy()
  })

  it('shows the upgrade message on a plan without it', async () => {
    h.fetchMock.mockImplementation(() => json({ locked: true, requiredPlan: 'pro' }, 402))
    await renderTab()
    expect((await screen.findByTestId('locked')).textContent).toBe('Flagged answers needs pro')
  })

  it('says only owners and admins can see them when the server returns 403', async () => {
    h.fetchMock.mockImplementation(() => json({ error: 'nope' }, 403))
    await renderTab()
    expect(await screen.findByText(/only workspace owners and admins/i)).toBeTruthy()
  })

  it('shows an error when the list cannot be loaded', async () => {
    h.fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    await renderTab()
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load flagged answers/i)
  })
})
