// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ARTICLE_USAGE_RETENTION_DAYS, ARTICLE_USAGE_WINDOW_DAYS, type Coverage } from '@/lib/kb/coverage'
import type { ArticleUsage } from '@/lib/db/queries/kb-usage'

/**
 * The Knowledge coverage tab: what it tells an owner about their assistant, and
 * the "try a question" box that runs the widget's real lookup. fetch is faked
 * per URL so each test controls both endpoints.
 */

const coverage: Coverage & { articleUsage: ArticleUsage[] } = {
  summary: { total: 4, live: 2, unpublished: 1, notSearchable: 1, sources: 2 },
  groups: [
    {
      key: 'source:1',
      kind: 'source',
      label: 'help-center.pdf',
      sourceType: 'pdf',
      total: 3,
      live: 1,
      items: [
        { id: 1, title: 'How do I reset my password?', status: 'live' },
        { id: 2, title: 'Refund policy', status: 'unpublished' },
        { id: 3, title: 'Invoices', status: 'not_searchable' },
      ],
    },
    {
      key: 'manual',
      kind: 'manual',
      label: 'Added by hand',
      sourceType: null,
      total: 1,
      live: 1,
      items: [{ id: 4, title: 'Opening hours', status: 'live' }],
    },
  ],
  truncated: false,
  articleUsage: [
    { article_id: 4, total: 2, recent: 1 },
    { article_id: 1, total: 12, recent: 3 },
  ],
}

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.stubGlobal('fetch', h.fetchMock)

function respond(json: unknown, ok = true) {
  return Promise.resolve(new Response(JSON.stringify(json), { status: ok ? 200 : 500 }))
}

function route(opts: { coverage?: unknown; coverageOk?: boolean; search?: unknown; searchOk?: boolean }) {
  h.fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/kb/coverage')) return respond(opts.coverage ?? coverage, opts.coverageOk ?? true)
    if (url.startsWith('/api/kb/search')) return respond(opts.search ?? { results: [], degraded: false }, opts.searchOk ?? true)
    return respond({}, false)
  })
}

async function renderTab() {
  const { CoverageTab } = await import('@/app/(dashboard)/kb/coverage-tab')
  return render(<CoverageTab />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CoverageTab: what the assistant knows', () => {
  it('shows the counts and explains how uncovered questions are answered', async () => {
    route({})
    await renderTab()
    await screen.findByText('Live articles')
    expect(screen.getByText('Live articles').previousElementSibling?.textContent).toBe('2')
    // The stat label and the per-article badge share their wording, so pick the card's label (the <p> with a value above it).
    const statValue = (label: string) =>
      screen.getAllByText(label).find((el) => el.tagName === 'P')?.previousElementSibling?.textContent
    expect(statValue('Unpublished')).toBe('1')
    expect(statValue('Not searchable')).toBe('1')
    expect(screen.getByText(/answers from general knowledge instead/i)).toBeTruthy()
  })

  it('lists every title under its source, flagging the ones the assistant cannot use', async () => {
    expect(ARTICLE_USAGE_RETENTION_DAYS).toBe(400)
    expect(ARTICLE_USAGE_WINDOW_DAYS).toBe(30)
    route({})
    await renderTab()
    const group = (await screen.findByText('help-center.pdf')).closest('details')!
    const rows = within(group).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('How do I reset my password?'),
      expect.stringContaining('Refund policy'),
      expect.stringContaining('Invoices'),
    ])
    expect(within(rows[0]).queryByText(/Unpublished|Not searchable/)).toBeNull()
    expect(within(rows[1]).getByText('Unpublished')).toBeTruthy()
    expect(within(rows[2]).getByText('Not searchable')).toBeTruthy()
    expect(screen.getByText('Opening hours')).toBeTruthy()

    expect(within(rows[0]).getByText('Supplied as context')).toBeTruthy()
    expect(within(rows[0]).getByText(`Recorded (up to ${ARTICLE_USAGE_RETENTION_DAYS} days): 12 · Last ${ARTICLE_USAGE_WINDOW_DAYS} days: 3`)).toBeTruthy()
    expect(within(rows[1]).getByText(`Recorded (up to ${ARTICLE_USAGE_RETENTION_DAYS} days): 0 · Last ${ARTICLE_USAGE_WINDOW_DAYS} days: 0`)).toBeTruthy()
    expect(within(rows[2]).getByText(`Recorded (up to ${ARTICLE_USAGE_RETENTION_DAYS} days): 0 · Last ${ARTICLE_USAGE_WINDOW_DAYS} days: 0`)).toBeTruthy()
    const manualRow = screen.getByText('Opening hours').closest('li')!
    expect(within(manualRow).getByText(`Recorded (up to ${ARTICLE_USAGE_RETENTION_DAYS} days): 2 · Last ${ARTICLE_USAGE_WINDOW_DAYS} days: 1`)).toBeTruthy()
    expect(screen.getByText(/counts answers an article was given to, not answers that quoted it/i)).toBeTruthy()
  })

  it('says plainly that an empty knowledge base gives the assistant nothing to answer from', async () => {
    route({ coverage: { summary: { total: 0, live: 0, unpublished: 0, notSearchable: 0, sources: 0 }, groups: [], truncated: false } })
    await renderTab()
    expect(await screen.findByText(/no articles to answer from/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /add sources/i }).getAttribute('href')).toBe('/kb')
  })

  it('shows usage counts without an unavailable banner when usage loaded successfully', async () => {
    route({ coverage: { ...coverage, articleUsageAvailable: true } })
    await renderTab()
    expect(screen.queryByText(/article usage could not be loaded/i)).toBeNull()
    const row = (await screen.findByText('How do I reset my password?')).closest('li')!
    expect(within(row).getByText('Recorded (up to 400 days): 12 · Last 30 days: 3')).toBeTruthy()
  })

  it('shows usage unavailable rather than zero when the usage query failed', async () => {
    route({ coverage: { ...coverage, articleUsage: [], articleUsageAvailable: false } })
    await renderTab()
    expect(await screen.findByText(/article usage could not be loaded/i)).toBeTruthy()
    const row = screen.getByText('How do I reset my password?').closest('li')!
    expect(within(row).getByText('Usage unavailable')).toBeTruthy()
    expect(within(row).queryByText('Recorded (up to 400 days): 0 · Last 30 days: 0')).toBeNull()
  })

  it('shows zero counts when the response has no usage field', async () => {
    route({ coverage: { summary: { total: 1, live: 1, unpublished: 0, notSearchable: 0, sources: 0 }, groups: [{ key: 'manual', kind: 'manual', label: 'Added by hand', sourceType: null, total: 1, live: 1, items: [{ id: 99, title: 'No usage field', status: 'live' }] }], truncated: false } })
    await renderTab()
    const row = (await screen.findByText('No usage field')).closest('li')!
    expect(within(row).getByText(`Recorded (up to ${ARTICLE_USAGE_RETENTION_DAYS} days): 0 · Last ${ARTICLE_USAGE_WINDOW_DAYS} days: 0`)).toBeTruthy()
  })

  it('notes when the list was cut off', async () => {
    route({ coverage: { ...coverage, truncated: true } })
    await renderTab()
    expect(await screen.findByText(/showing the first 4 articles/i)).toBeTruthy()
  })

  it('shows an error rather than an empty page when loading fails', async () => {
    route({ coverageOk: false, coverage: { error: 'Internal server error' } })
    await renderTab()
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load/i)
  })
})

describe('CoverageTab: try a customer question', () => {
  async function ask(question: string) {
    await renderTab()
    const input = await screen.findByLabelText('Customer question to test')
    const user = userEvent.setup()
    await user.type(input, question)
    await user.click(screen.getByRole('button', { name: 'Check' }))
  }

  it('keeps Check disabled until there is a question', async () => {
    route({})
    await renderTab()
    const button = await screen.findByRole('button', { name: 'Check' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports Covered with the matching articles and their scores', async () => {
    route({
      search: {
        degraded: false,
        results: [
          { id: 1, question: 'How do I reset my password?', answer: 'a', score: 0.91 },
          { id: 4, question: 'Opening hours', answer: 'a', score: 0.52 },
        ],
      },
    })
    await ask('reset password')
    const status = await screen.findByText(/^Covered/)
    const box = status.closest('[role="status"]') as HTMLElement
    expect(box.textContent).toContain('How do I reset my password?')
    expect(box.textContent).toContain('91% match')
    expect(box.textContent).toContain('2 articles')
    expect(h.fetchMock).toHaveBeenCalledWith('/api/kb/search?q=reset%20password')
  })

  it('only shows as many matches as the widget actually retrieves', async () => {
    route({
      search: {
        degraded: false,
        results: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, question: `Match ${i + 1}`, answer: 'a', score: 0.9 })),
      },
    })
    await ask('anything')
    const box = (await screen.findByText(/^Covered/)).closest('[role="status"]') as HTMLElement
    expect(within(box).getAllByRole('listitem')).toHaveLength(5)
  })

  it('reports Not covered, and that the answer would come from general knowledge', async () => {
    route({ search: { results: [], degraded: false } })
    await ask('do you ship to mars')
    expect(await screen.findByText(/^Not covered/)).toBeTruthy()
    expect(screen.getByText(/answer this from general knowledge/i)).toBeTruthy()
  })

  it('refuses to call a keyword-only fallback "covered"', async () => {
    route({ search: { results: [{ id: 1, question: 'Looks like a hit', answer: 'a' }], degraded: true } })
    await ask('password')
    expect(await screen.findByText(/semantic search is unavailable/i)).toBeTruthy()
    expect(screen.queryByText(/^Covered/)).toBeNull()
    expect(screen.queryByText('Looks like a hit')).toBeNull()
  })

  it('shows the error when the test cannot run', async () => {
    route({ search: { error: 'Too many requests' }, searchOk: false })
    await ask('anything')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Too many requests'))
  })
})
