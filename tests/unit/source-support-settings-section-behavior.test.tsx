// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Behavior the base section test does not reach: every switch toggling on its
 * own, the excerpt opt-in staying separate, the pending state while a save is
 * in flight, the number-box limits, cleared boxes, load errors that are not a
 * permission problem, and what is shown after a save followed by a refusal.
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

const SURFACES: Array<[string, string]> = [
  ['Website chat widget', 'widgetEnabled'],
  ['Support ticket drafts', 'ticketEnabled'],
  ['Discord /ask', 'discordEnabled'],
  ['Agent API and MCP', 'agentApiEnabled'],
]
const SAMPLING = 'Share of answers to check (%)'
const DAILY = 'Most checks per day'
const EXCERPT = /Keep short evidence excerpts/

function sentForm(): FormData {
  return h.saveSourceSupportSettingsAction.mock.calls[0][1] as FormData
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getSourceSupportSettingsAction.mockResolvedValue({ settings: { ...OFF } })
  h.saveSourceSupportSettingsAction.mockResolvedValue({ settings: { ...OFF } })
})

describe('SourceSupportSection behavior', () => {
  it('shows a loading note and no form until the settings arrive', async () => {
    let resolve!: (v: unknown) => void
    h.getSourceSupportSettingsAction.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<SourceSupportSection />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    resolve({ settings: { ...OFF } })
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it.each(SURFACES)('%s toggles on its own and is the only switch submitted', async (label, field) => {
    const user = userEvent.setup()
    render(<SourceSupportSection />)
    await user.click(await screen.findByLabelText(label))
    for (const [other] of SURFACES) {
      if (other === label) expect(screen.getByLabelText(other)).toBeChecked()
      else expect(screen.getByLabelText(other)).not.toBeChecked()
    }
    expect(screen.getByLabelText(EXCERPT)).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.saveSourceSupportSettingsAction).toHaveBeenCalled())
    const fd = sentForm()
    for (const [, name] of SURFACES) expect(fd.get(name)).toBe(name === field ? 'on' : null)
    expect(fd.get('excerptStorageEnabled')).toBeNull()
  })

  it('unchecking a stored-on switch leaves it out of the submission', async () => {
    h.getSourceSupportSettingsAction.mockResolvedValue({ settings: { ...OFF, discordEnabled: true, widgetEnabled: true } })
    const user = userEvent.setup()
    render(<SourceSupportSection />)
    await user.click(await screen.findByLabelText('Discord /ask'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.saveSourceSupportSettingsAction).toHaveBeenCalled())
    expect(sentForm().get('discordEnabled')).toBeNull()
    expect(sentForm().get('widgetEnabled')).toBe('on')
  })

  it('the excerpt opt-in is separate: turning on a surface does not turn it on, and it can be sent alone', async () => {
    const user = userEvent.setup()
    render(<SourceSupportSection />)
    await user.click(await screen.findByLabelText('Website chat widget'))
    expect(screen.getByLabelText(EXCERPT)).not.toBeChecked()
    await user.click(screen.getByLabelText('Website chat widget'))
    await user.click(screen.getByLabelText(EXCERPT))
    expect(screen.getByLabelText(EXCERPT)).toBeChecked()
    for (const [label] of SURFACES) expect(screen.getByLabelText(label)).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.saveSourceSupportSettingsAction).toHaveBeenCalled())
    expect(sentForm().get('excerptStorageEnabled')).toBe('on')
    for (const [, name] of SURFACES) expect(sentForm().get(name)).toBeNull()
  })

  it('turning the excerpt opt-in off is submitted as absent', async () => {
    h.getSourceSupportSettingsAction.mockResolvedValue({ settings: { ...OFF, excerptStorageEnabled: true } })
    const user = userEvent.setup()
    render(<SourceSupportSection />)
    await user.click(await screen.findByLabelText(EXCERPT))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.saveSourceSupportSettingsAction).toHaveBeenCalled())
    expect(sentForm().get('excerptStorageEnabled')).toBeNull()
  })

  it('disables the button and says Saving while a save is in flight, then recovers', async () => {
    let resolve!: (v: unknown) => void
    h.saveSourceSupportSettingsAction.mockReturnValue(new Promise((r) => (resolve = r)))
    const user = userEvent.setup()
    render(<SourceSupportSection />)
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    const busy = await screen.findByRole('button', { name: 'Saving…' })
    expect(busy).toBeDisabled()
    expect(screen.queryByText('Saved.')).toBeNull()
    resolve({ settings: { ...OFF } })
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('limits the number boxes: share 0 to 100, daily limit whole numbers from 0', async () => {
    render(<SourceSupportSection />)
    const share = await screen.findByLabelText(SAMPLING)
    expect(share).toHaveAttribute('type', 'number')
    expect(share).toHaveAttribute('min', '0')
    expect(share).toHaveAttribute('max', '100')
    const daily = screen.getByLabelText(DAILY)
    expect(daily).toHaveAttribute('type', 'number')
    expect(daily).toHaveAttribute('min', '0')
    expect(daily).toHaveAttribute('step', '1')
  })

  it('shows the stored rate as a percentage without losing decimals', async () => {
    h.getSourceSupportSettingsAction.mockResolvedValue({ settings: { ...OFF, samplingRate: 0.125, dailyLimit: 0 } })
    render(<SourceSupportSection />)
    expect(await screen.findByLabelText(SAMPLING)).toHaveValue(12.5)
    expect(screen.getByLabelText(DAILY)).toHaveValue(0)
  })

  it('a cleared box is submitted empty so the server can treat it as unset', async () => {
    h.getSourceSupportSettingsAction.mockResolvedValue({ settings: { ...OFF, samplingRate: 0.5, dailyLimit: 20 } })
    const user = userEvent.setup()
    render(<SourceSupportSection />)
    await user.clear(await screen.findByLabelText(SAMPLING))
    await user.clear(screen.getByLabelText(DAILY))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.saveSourceSupportSettingsAction).toHaveBeenCalled())
    expect(sentForm().get('samplingPercent')).toBe('')
    expect(sentForm().get('dailyLimit')).toBe('')
  })

  it('shows what the server stored, not what was typed', async () => {
    h.saveSourceSupportSettingsAction.mockResolvedValue({ settings: { ...OFF, samplingRate: 0.5, dailyLimit: 12 } })
    const user = userEvent.setup()
    render(<SourceSupportSection />)
    await user.type(await screen.findByLabelText(SAMPLING), '80')
    await user.type(screen.getByLabelText(DAILY), '3')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved.')
    expect(screen.getByLabelText(SAMPLING)).toHaveValue(50)
    expect(screen.getByLabelText(DAILY)).toHaveValue(12)
  })

  it('a refusal after a good save keeps the saved values and the new typing, and drops the Saved note', async () => {
    h.saveSourceSupportSettingsAction
      .mockResolvedValueOnce({ settings: { ...OFF, dailyLimit: 5 } })
      .mockResolvedValueOnce({ error: 'The daily limit must be a whole number' })
    const user = userEvent.setup()
    render(<SourceSupportSection />)
    await user.type(await screen.findByLabelText(DAILY), '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved.')

    await user.clear(screen.getByLabelText(DAILY))
    await user.type(screen.getByLabelText(DAILY), '2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The daily limit must be a whole number')
    expect(screen.getByLabelText(DAILY)).toHaveValue(2)
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('a load error that is not a permission problem is shown as given, with no form', async () => {
    h.getSourceSupportSettingsAction.mockResolvedValue({ error: 'Workspace not found' })
    render(<SourceSupportSection />)
    expect(await screen.findByText('Workspace not found')).toBeInTheDocument()
    expect(screen.queryByText(/Only workspace owners and admins/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('falls back to a generic message when the load returns neither settings nor an error', async () => {
    h.getSourceSupportSettingsAction.mockResolvedValue({})
    render(<SourceSupportSection />)
    expect(await screen.findByText('Settings unavailable')).toBeInTheDocument()
  })
})
