// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetSection } from '@/components/settings/widget'

/**
 * Behavioral coverage for the "Ask for an email" dropdown in WidgetSection —
 * the settings UI half of saveWidgetLeadCaptureModeAction (see
 * widget-lead-capture-action.test.ts for the action itself). Mock setup
 * mirrors tests/unit/api-keys-section.test.tsx, the existing precedent for
 * importing one named export out of this same file without pulling in every
 * other section's real server actions.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

const h = vi.hoisted(() => ({
  getWidgetTokenAction: vi.fn(),
  saveWidgetLeadCaptureModeAction: vi.fn(),
  saveWidgetOriginsAction: vi.fn(),
  saveWidgetDailyLimitAction: vi.fn(),
}))

vi.mock('@/lib/actions/widget', () => ({
  getWidgetTokenAction: h.getWidgetTokenAction,
  regenerateWidgetTokenAction: vi.fn(),
  saveWidgetOriginsAction: h.saveWidgetOriginsAction,
  saveWidgetDailyLimitAction: h.saveWidgetDailyLimitAction,
  saveWidgetLeadCaptureModeAction: h.saveWidgetLeadCaptureModeAction,
  saveWidgetAnswerScopeAction: vi.fn(),
  saveWidgetGuidanceAction: vi.fn(),
}))
vi.mock('@/lib/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/lib/actions/invitations', () => ({
  sendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  removeMemberAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}))
vi.mock('@/lib/actions/ai-config', () => ({
  saveAIConfigAction: vi.fn(),
  clearAIConfigAction: vi.fn(),
  testAIConfigAction: vi.fn(),
  listModelsAction: vi.fn(),
  includedEmbeddingsAvailableAction: vi.fn(),
}))
vi.mock('@/lib/actions/roi', () => ({ saveROIConfigAction: vi.fn() }))
vi.mock('@/lib/actions/api-keys', () => ({ createApiKeyAction: vi.fn(), revokeApiKeyAction: vi.fn() }))
vi.mock('@/lib/actions/account', () => ({ deleteAccountAction: vi.fn(), getCurrentOrgName: vi.fn(async () => null) }))
vi.mock('@/components/settings/source-support', () => ({ SourceSupportSection: () => null }))
vi.mock('@/components/settings/kb-page-titles', () => ({ KbPageTitlesSection: () => null }))
vi.mock('@/components/billing/widget-branding-upsell', () => ({ WidgetBrandingUpsell: () => null }))

const baseToken = {
  token: 'a'.repeat(48),
  expiresAt: '2099-01-01T00:00:00.000Z',
  allowedOrigins: '',
  canManage: true,
}

beforeEach(() => {
  vi.clearAllMocks()
})

async function renderWidgetSection() {
  const utils = render(<WidgetSection />)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
  return utils
}

describe('WidgetSection: what the widget answers from', () => {
  it('starts from the saved scope and note once the token has loaded', async () => {
    h.getWidgetTokenAction.mockResolvedValue({
      ...baseToken,
      leadCaptureMode: 'off',
      answerScope: 'general',
      guidance: 'Be warm.',
    })
    await renderWidgetSection()
    expect((screen.getByLabelText('What the widget answers from') as HTMLSelectElement).value).toBe('general')
    expect((screen.getByLabelText('Guidance for the widget') as HTMLTextAreaElement).value).toBe('Be warm.')
  })

  it('shows a member the saved settings as text, with no controls', async () => {
    h.getWidgetTokenAction.mockResolvedValue({
      ...baseToken,
      canManage: false,
      leadCaptureMode: 'off',
      answerScope: 'knowledge-base-only',
      guidance: null,
    })
    await renderWidgetSection()
    expect(screen.queryByLabelText('What the widget answers from')).toBeNull()
    expect(screen.getByText(/Only from my knowledge base\. Only owners and admins can change this\./)).toBeTruthy()
    expect(screen.getByText(/No guidance set\./)).toBeTruthy()
  })
})

describe('WidgetSection: Ask for an email', () => {
  it('shows the org\'s current lead-capture mode, selected in the dropdown', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, leadCaptureMode: 'up-front' })
    await renderWidgetSection()

    const select = screen.getByDisplayValue("Before the conversation starts") as HTMLSelectElement
    expect(select.value).toBe('up-front')
  })

  it('defaults the dropdown to on-failure when the action has not returned a mode yet', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, leadCaptureMode: undefined })
    await renderWidgetSection()

    const select = screen.getByRole('combobox', { name: 'Ask for an email' }) as HTMLSelectElement
    expect(select.value).toBe('on-failure')
  })

  it('saves the newly picked mode via saveWidgetLeadCaptureModeAction, scoped to the caller\'s org by the action itself', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, leadCaptureMode: 'on-failure' })
    h.saveWidgetLeadCaptureModeAction.mockResolvedValue({ mode: 'off' })
    await renderWidgetSection()

    const select = screen.getByRole('combobox', { name: 'Ask for an email' }) as HTMLSelectElement
    const user = userEvent.setup()
    await act(async () => {
      await user.selectOptions(select, 'off')
    })

    await waitFor(() => expect(h.saveWidgetLeadCaptureModeAction).toHaveBeenCalledTimes(1))
    const [, formData] = h.saveWidgetLeadCaptureModeAction.mock.calls[0] as [unknown, FormData]
    expect(formData.get('mode')).toBe('off')
    expect(select.value).toBe('off')
  })

  it('reverts the dropdown and shows the error when the save is rejected', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, leadCaptureMode: 'on-failure' })
    h.saveWidgetLeadCaptureModeAction.mockResolvedValue({ error: 'You do not have permission to do that.' })
    await renderWidgetSection()

    const select = screen.getByRole('combobox', { name: 'Ask for an email' }) as HTMLSelectElement
    const user = userEvent.setup()
    await act(async () => {
      await user.selectOptions(select, 'off')
    })

    await waitFor(() => expect(screen.getByText('You do not have permission to do that.')).toBeTruthy())
    expect(select.value).toBe('on-failure')
  })

  it('shows the mode read-only, with no dropdown, when the viewer cannot manage the widget', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, canManage: false, leadCaptureMode: 'off' })
    await renderWidgetSection()

    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText(/never asked/i)).toBeTruthy()
  })
})

describe('WidgetSection: widget token load failure', () => {
  it('shows "Failed to load widget token." instead of being stuck on "Loading…" when getWidgetTokenAction rejects', async () => {
    h.getWidgetTokenAction.mockRejectedValue(new Error('network down'))

    render(<WidgetSection />)

    // Without the .catch() on the action's promise chain, a rejection (as
    // opposed to a resolved-but-empty result) would leave `loading` true
    // forever and the component stuck on "Loading…".
    await waitFor(() => expect(screen.getByText('Failed to load widget token.')).toBeTruthy())
    expect(screen.queryByText('Loading…')).toBeNull()
  })
})

describe('WidgetSection: daily answer limit', () => {
  it('does not render the limit control until the action reports a ceiling', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, dailyAnswerLimit: 300 })
    await renderWidgetSection()
    expect(screen.queryByTestId('widget-daily-limit')).toBeNull()
  })

  it('renders the control for an admin, seeded with the saved limit and the ceiling', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, dailyAnswerLimit: 300, dailyAnswerCeiling: 5000 })
    await renderWidgetSection()
    expect(screen.getByTestId('widget-daily-limit')).toBeTruthy()
    const input = screen.getByLabelText('Daily answer limit') as HTMLInputElement
    expect(input.value).toBe('300')
    expect(input.placeholder).toBe('5,000')
  })

  it('treats a missing limit as none of their own, so the field starts empty', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, dailyAnswerCeiling: 5000 })
    await renderWidgetSection()
    expect((screen.getByLabelText('Daily answer limit') as HTMLInputElement).value).toBe('')
  })

  it('saves through saveWidgetDailyLimitAction from inside the section', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, dailyAnswerLimit: null, dailyAnswerCeiling: 5000 })
    h.saveWidgetDailyLimitAction.mockResolvedValue({ limit: 40 })
    await renderWidgetSection()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Daily answer limit'), '40')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))

    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    const [, fd] = h.saveWidgetDailyLimitAction.mock.calls[0] as [unknown, FormData]
    expect(fd.get('limit')).toBe('40')
  })

  it('shows a member the effective limit as read-only text', async () => {
    h.getWidgetTokenAction.mockResolvedValue({
      ...baseToken,
      canManage: false,
      dailyAnswerLimit: null,
      dailyAnswerCeiling: 5000,
    })
    await renderWidgetSection()
    expect(screen.queryByLabelText('Daily answer limit')).toBeNull()
    expect(screen.getByText('5,000 answers a day. Only owners and admins can change this.')).toBeTruthy()
  })
})

describe('WidgetSection: allowed domains save message', () => {
  it('shows the action error when entries are refused, and keeps the typed list', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, allowedOrigins: 'example.com' })
    const refusal =
      "This entry can't be used: not a domain!. Enter a site's domain, such as example.com; each domain also covers its subdomains."
    h.saveWidgetOriginsAction.mockResolvedValue({ error: refusal })
    await renderWidgetSection()

    const textarea = screen.getByPlaceholderText(/example\.com/) as HTMLTextAreaElement
    const user = userEvent.setup()
    await user.clear(textarea)
    await user.type(textarea, 'not a domain!')
    await user.click(screen.getByRole('button', { name: 'Save domains' }))

    await waitFor(() => expect(screen.getByText(refusal)).toBeTruthy())
    const [, fd] = h.saveWidgetOriginsAction.mock.calls[0] as [unknown, FormData]
    expect(fd.get('origins')).toBe('not a domain!')
    expect(textarea.value).toBe('not a domain!')
    expect((screen.getByRole('button', { name: 'Save domains' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('reports how many domains were saved when the action accepts them', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, allowedOrigins: '' })
    h.saveWidgetOriginsAction.mockResolvedValue({ origins: ['example.com', 'docs.example.com'] })
    await renderWidgetSection()

    const textarea = screen.getByPlaceholderText(/example\.com/) as HTMLTextAreaElement
    const user = userEvent.setup()
    await user.type(textarea, 'https://example.com{enter}docs.example.com')
    await user.click(screen.getByRole('button', { name: 'Save domains' }))

    await waitFor(() => expect(screen.getByText('Saved. The widget will load on 2 domains.')).toBeTruthy())
    expect(textarea.value).toBe('example.com\ndocs.example.com')
  })
})
