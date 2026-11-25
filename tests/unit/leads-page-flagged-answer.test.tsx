// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

/**
 * The Leads page: a lead left through the thumbs-down panel carries no question
 * of its own, so the page shows the answer it flagged instead. A lead that has a
 * question keeps showing it, and a lead with neither shows a dash.
 */

const h = vi.hoisted(() => ({
  listWidgetLeads: vi.fn(),
  listFlagsForLeads: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: async () => ({ orgId: 7 }) }))
vi.mock('@/lib/db/queries/widget-leads', () => ({ listWidgetLeads: h.listWidgetLeads }))
vi.mock('@/lib/db/queries/widget-answer-flags', () => ({ listFlagsForLeads: h.listFlagsForLeads }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: async () => true }))
vi.mock('@/components/billing/locked-csv-export-button', () => ({ LockedCsvExportButton: () => null }))

const lead = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  orgId: 7,
  widgetToken: 'a'.repeat(48),
  email: `person${id}@example.com`,
  question: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  ...over,
})

async function renderPage() {
  const { default: LeadsPage } = await import('@/app/(dashboard)/leads/page')
  return render(await LeadsPage())
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  h.listFlagsForLeads.mockResolvedValue(new Map())
})

describe('Leads page: flagged answers', () => {
  it('shows the flagged question, reply and reason for a lead that came from a flag, with a link to it', async () => {
    h.listWidgetLeads.mockResolvedValue([lead(5)])
    h.listFlagsForLeads.mockResolvedValue(
      new Map([[5, { flag_id: 11, lead_id: 5, reason: 'outdated', question: 'How do I export?', answer: 'Use Settings.' }]])
    )
    await renderPage()
    const block = screen.getByTestId('lead-flagged-answer')
    expect(within(block).getByText('Flagged an answer: Out of date')).toBeTruthy()
    expect(within(block).getByText('Asked: How do I export?')).toBeTruthy()
    expect(within(block).getByText('Answered: Use Settings.')).toBeTruthy()
    expect(within(block).getByRole('link', { name: 'See the flag' }).getAttribute('href')).toBe('/kb?tab=flags')
    expect(h.listFlagsForLeads).toHaveBeenCalledWith(7)
  })

  it('says the text is no longer stored once the retention window has cleared it', async () => {
    h.listWidgetLeads.mockResolvedValue([lead(5)])
    h.listFlagsForLeads.mockResolvedValue(
      new Map([[5, { flag_id: 11, lead_id: 5, reason: null, question: '', answer: '' }]])
    )
    await renderPage()
    const block = screen.getByTestId('lead-flagged-answer')
    expect(within(block).getByText('Flagged an answer')).toBeTruthy()
    expect(within(block).getByText(/no longer stored/i)).toBeTruthy()
  })

  it('keeps showing a lead\'s own question rather than a flag', async () => {
    h.listWidgetLeads.mockResolvedValue([lead(5, { question: 'Where is my invoice?' })])
    h.listFlagsForLeads.mockResolvedValue(
      new Map([[5, { flag_id: 11, lead_id: 5, reason: 'other', question: 'x', answer: 'y' }]])
    )
    await renderPage()
    expect(screen.getByText('Where is my invoice?')).toBeTruthy()
    expect(screen.queryByTestId('lead-flagged-answer')).toBeNull()
  })

  it('shows a dash for a lead with neither a question nor a flag', async () => {
    h.listWidgetLeads.mockResolvedValue([lead(5)])
    await renderPage()
    expect(screen.queryByTestId('lead-flagged-answer')).toBeNull()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('matches each flag to its own lead', async () => {
    h.listWidgetLeads.mockResolvedValue([lead(5), lead(6)])
    h.listFlagsForLeads.mockResolvedValue(
      new Map([[6, { flag_id: 12, lead_id: 6, reason: 'wrong_information', question: 'q for six', answer: 'a for six' }]])
    )
    await renderPage()
    const blocks = screen.getAllByTestId('lead-flagged-answer')
    expect(blocks).toHaveLength(1)
    const row = blocks[0].closest('tr')!
    expect(within(row).getByText('person6@example.com')).toBeTruthy()
  })

  it('never shows the visitor\'s note', async () => {
    h.listWidgetLeads.mockResolvedValue([lead(5)])
    h.listFlagsForLeads.mockResolvedValue(
      new Map([[5, { flag_id: 11, lead_id: 5, reason: 'other', question: 'q', answer: 'a', note: 'secret note' }]])
    )
    await renderPage()
    expect(screen.queryByText(/secret note/)).toBeNull()
  })
})
