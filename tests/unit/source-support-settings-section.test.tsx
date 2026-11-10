// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The Source support settings section: what an owner or admin sees and can
 * change, what a member sees instead, that a save shows what was stored, and
 * that a refused save keeps what was typed and says why.
 */

const h = vi.hoisted(() => ({
  getSourceSupportSettingsAction: vi.fn(),
  saveSourceSupportSettingsAction: vi.fn(),
}))

vi.mock('@/lib/actions/source-support', () => ({
  getSourceSupportSettingsAction: h.getSourceSupportSettingsAction,
  saveSourceSupportSettingsAction: h.saveSourceSupportSettingsAction,
}))

import { SourceSupportSection } from '@/components/settings/source-support'

const OFF = {
  widgetEnabled: false,
  ticketEnabled: false,
  discordEnabled: false,
  agentApiEnabled: false,
  samplingRate: null,
  dailyLimit: null,
  excerptStorageEnabled: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getSourceSupportSettingsAction.mockResolvedValue({ settings: { ...OFF } })
})

describe('SourceSupportSection', () => {
  it('shows everything off and unset by default, with the reply-is-never-changed note', async () => {
    render(<SourceSupportSection />)
    expect(await screen.findByLabelText('Website chat widget')).not.toBeChecked()
    expect(screen.getByLabelText('Support ticket drafts')).not.toBeChecked()
    expect(screen.getByLabelText('Discord /ask')).not.toBeChecked()
    expect(screen.getByLabelText('Agent API and MCP')).not.toBeChecked()
    expect(screen.getByLabelText(/Keep short evidence excerpts/)).not.toBeChecked()
    expect(screen.getByLabelText('Share of answers to check (%)')).toHaveValue(null)
    expect(screen.getByLabelText('Most checks per day')).toHaveValue(null)
    expect(screen.getByText(/never changes or delays a reply/)).toBeInTheDocument()
    expect(screen.getByText(/Separate from the switches above and off by default/)).toBeInTheDocument()
  })

  it('shows the stored values: switches, the rate as a percentage, the limit', async () => {
    h.getSourceSupportSettingsAction.mockResolvedValue({
      settings: { ...OFF, ticketEnabled: true, samplingRate: 0.25, dailyLimit: 40, excerptStorageEnabled: true },
    })
    render(<SourceSupportSection />)
    expect(await screen.findByLabelText('Support ticket drafts')).toBeChecked()
    expect(screen.getByLabelText('Website chat widget')).not.toBeChecked()
    expect(screen.getByLabelText('Share of answers to check (%)')).toHaveValue(25)
    expect(screen.getByLabelText('Most checks per day')).toHaveValue(40)
    expect(screen.getByLabelText(/Keep short evidence excerpts/)).toBeChecked()
  })

  it('a member sees a note instead of the form', async () => {
    h.getSourceSupportSettingsAction.mockResolvedValue({ error: 'You do not have permission to do that.' })
    render(<SourceSupportSection />)
    expect(await screen.findByText('Only workspace owners and admins can view or change these settings.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByLabelText('Website chat widget')).toBeNull()
  })

  it('a failed load says so, and shows no form with defaults that could be mistaken for saved values', async () => {
    h.getSourceSupportSettingsAction.mockRejectedValue(new Error('network'))
    render(<SourceSupportSection />)
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('submits the switches and boxes, then shows what was stored', async () => {
    h.saveSourceSupportSettingsAction.mockImplementation(async (_prev: unknown, fd: FormData) => ({
      settings: {
        ...OFF,
        widgetEnabled: fd.get('widgetEnabled') === 'on',
        samplingRate: Number(fd.get('samplingPercent')) / 100,
        dailyLimit: Number(fd.get('dailyLimit')),
      },
    }))
    const user = userEvent.setup()
    render(<SourceSupportSection />)

    await user.click(await screen.findByLabelText('Website chat widget'))
    await user.type(screen.getByLabelText('Share of answers to check (%)'), '10')
    await user.type(screen.getByLabelText('Most checks per day'), '50')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument())
    const fd = h.saveSourceSupportSettingsAction.mock.calls[0][1] as FormData
    expect(fd.get('widgetEnabled')).toBe('on')
    expect(fd.get('ticketEnabled')).toBeNull()
    expect(fd.get('samplingPercent')).toBe('10')
    expect(fd.get('dailyLimit')).toBe('50')
    expect(screen.getByLabelText('Website chat widget')).toBeChecked()
    expect(screen.getByLabelText('Share of answers to check (%)')).toHaveValue(10)
  })

  it('a refused save shows the reason and keeps what was typed', async () => {
    h.saveSourceSupportSettingsAction.mockResolvedValue({ error: 'The share of answers must be from 0 to 100' })
    const user = userEvent.setup()
    render(<SourceSupportSection />)

    await user.type(await screen.findByLabelText('Most checks per day'), '7')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The share of answers must be from 0 to 100')
    expect(screen.getByLabelText('Most checks per day')).toHaveValue(7)
    expect(screen.queryByText('Saved.')).toBeNull()
  })
})
