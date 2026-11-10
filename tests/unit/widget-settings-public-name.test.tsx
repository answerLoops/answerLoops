// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetSection } from '@/app/(dashboard)/settings/page'

/**
 * Behavioral coverage for the "Public name" field in WidgetSection: the
 * stable slug that replaces the rotating token in the embed snippet. Mock
 * setup mirrors widget-settings-lead-capture.test.tsx.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

const h = vi.hoisted(() => ({
  getWidgetTokenAction: vi.fn(),
  saveWidgetSlugAction: vi.fn(),
}))

vi.mock('@/lib/actions/widget', () => ({
  getWidgetTokenAction: h.getWidgetTokenAction,
  regenerateWidgetTokenAction: vi.fn(),
  saveWidgetOriginsAction: vi.fn(),
  saveWidgetLeadCaptureModeAction: vi.fn(),
  saveWidgetSlugAction: h.saveWidgetSlugAction,
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
vi.mock('@/components/billing/widget-branding-upsell', () => ({ WidgetBrandingUpsell: () => null }))

const TOKEN = 'a'.repeat(48)
const baseToken = {
  token: TOKEN,
  expiresAt: '2099-01-01T00:00:00.000Z',
  allowedOrigins: '',
  canManage: true,
  leadCaptureMode: 'on-failure',
}

beforeEach(() => {
  vi.clearAllMocks()
})

async function renderWidgetSection() {
  const utils = render(<WidgetSection />)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
  return utils
}

function nameInput() {
  return screen.getByLabelText('Public name') as HTMLInputElement
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save name' }) as HTMLButtonElement
}

/** The id the embed snippet carries, read from the rendered snippet text. */
function snippetWidgetId(): string | null {
  const el = screen.getAllByText((_, node) => !!node?.textContent?.includes('data-widget-id='))
    .filter((n) => n.children.length === 0)[0]
  const match = el?.textContent?.match(/data-widget-id="([^"]*)"/)
  return match ? match[1] : null
}

describe('WidgetSection: Public name', () => {
  it('hydrates the input from the slug returned by getWidgetTokenAction', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, slug: 'acme-support' })
    await renderWidgetSection()

    expect(nameInput().value).toBe('acme-support')
    expect(snippetWidgetId()).toBe('acme-support')
  })

  it('leaves the input empty and the snippet on the token when no slug is set', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, slug: null })
    await renderWidgetSection()

    expect(nameInput().value).toBe('')
    expect(snippetWidgetId()).toBe(TOKEN)
  })

  it('keeps Save disabled until the draft differs from the saved name', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, slug: 'acme-support' })
    await renderWidgetSection()
    const user = userEvent.setup()

    expect(saveButton().disabled).toBe(true)

    await act(async () => {
      await user.type(nameInput(), '2')
    })
    expect(saveButton().disabled).toBe(false)

    await act(async () => {
      await user.type(nameInput(), '{Backspace}')
    })
    expect(nameInput().value).toBe('acme-support')
    expect(saveButton().disabled).toBe(true)
  })

  it('saves the draft via saveWidgetSlugAction, shows the Saved message and switches the snippet to the slug', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, slug: null })
    h.saveWidgetSlugAction.mockResolvedValue({ slug: 'acme-support' })
    await renderWidgetSection()
    const user = userEvent.setup()

    await act(async () => {
      await user.type(nameInput(), 'acme-support')
    })
    await act(async () => {
      await user.click(saveButton())
    })

    await waitFor(() => expect(h.saveWidgetSlugAction).toHaveBeenCalledTimes(1))
    const [, formData] = h.saveWidgetSlugAction.mock.calls[0] as [unknown, FormData]
    expect(formData.get('slug')).toBe('acme-support')

    await waitFor(() => expect(screen.getByText(/^Saved\./)).toBeTruthy())
    expect(snippetWidgetId()).toBe('acme-support')
    // Now in sync with the saved value, so Save is disabled again.
    expect(saveButton().disabled).toBe(true)
  })

  it('shows the action error and keeps the token in the snippet when the save is rejected', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, slug: null })
    h.saveWidgetSlugAction.mockResolvedValue({ error: 'That name is already taken.' })
    await renderWidgetSection()
    const user = userEvent.setup()

    await act(async () => {
      await user.type(nameInput(), 'taken-name')
    })
    await act(async () => {
      await user.click(saveButton())
    })

    await waitFor(() => expect(screen.getByText('That name is already taken.')).toBeTruthy())
    expect(snippetWidgetId()).toBe(TOKEN)
    expect(screen.queryByText(/^Saved\./)).toBeNull()
  })

  it('shows the Cleared message and falls back to the token when a saved name is cleared', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, slug: 'acme-support' })
    h.saveWidgetSlugAction.mockResolvedValue({ slug: null })
    await renderWidgetSection()
    const user = userEvent.setup()

    expect(snippetWidgetId()).toBe('acme-support')

    await act(async () => {
      await user.clear(nameInput())
    })
    expect(saveButton().disabled).toBe(false)
    await act(async () => {
      await user.click(saveButton())
    })

    await waitFor(() => expect(h.saveWidgetSlugAction).toHaveBeenCalledTimes(1))
    const [, formData] = h.saveWidgetSlugAction.mock.calls[0] as [unknown, FormData]
    expect(formData.get('slug')).toBe('')

    await waitFor(() => expect(screen.getByText(/^Cleared\./)).toBeTruthy())
    expect(snippetWidgetId()).toBe(TOKEN)
    expect(nameInput().value).toBe('')
  })

  it('tells the owner embeds keep working on rotate when a public name is set', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, slug: 'acme-support' })
    await renderWidgetSection()
    const user = userEvent.setup()

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Regenerate token' }))
    })

    expect(screen.getByText('Embeds that use your public name keep working.')).toBeTruthy()
    expect(screen.queryByText('Old token breaks immediately.')).toBeNull()
  })

  it('warns that the old token breaks immediately on rotate when no public name is set', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, slug: null })
    await renderWidgetSection()
    const user = userEvent.setup()

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Regenerate token' }))
    })

    expect(screen.getByText('Old token breaks immediately.')).toBeTruthy()
    expect(screen.queryByText('Embeds that use your public name keep working.')).toBeNull()
  })

  it('shows the name read-only, with no input, when the viewer cannot manage the widget', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, canManage: false, slug: 'acme-support' })
    await renderWidgetSection()

    expect(screen.queryByLabelText('Public name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull()
    expect(screen.getByText(/Public name: acme-support\./)).toBeTruthy()
    expect(screen.getByText(/Public name: acme-support\. Only owners and admins can change this/)).toBeTruthy()
  })

  it('says no public name is set to a non-manager when there is no slug', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ ...baseToken, canManage: false, slug: null })
    await renderWidgetSection()

    expect(screen.queryByLabelText('Public name')).toBeNull()
    expect(screen.getByText(/No public name set\./)).toBeTruthy()
  })
})
