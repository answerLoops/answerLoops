// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetSection } from '@/app/(dashboard)/settings/page'

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
}))

vi.mock('@/lib/actions/widget', () => ({
  getWidgetTokenAction: h.getWidgetTokenAction,
  regenerateWidgetTokenAction: vi.fn(),
  saveWidgetOriginsAction: vi.fn(),
  saveWidgetLeadCaptureModeAction: h.saveWidgetLeadCaptureModeAction,
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

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('on-failure')
  })

  it('saves the newly picked mode via saveWidgetLeadCaptureModeAction, scoped to the caller\'s org by the action itself', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, leadCaptureMode: 'on-failure' })
    h.saveWidgetLeadCaptureModeAction.mockResolvedValue({ mode: 'off' })
    await renderWidgetSection()

    const select = screen.getByRole('combobox') as HTMLSelectElement
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

    const select = screen.getByRole('combobox') as HTMLSelectElement
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
