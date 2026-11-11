// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import IntegrationsPage from '@/app/(dashboard)/integrations/page'
import { useSearchParams } from 'next/navigation'

// IntegrationsPage pulls in a large surface of server actions purely to wire
// up its child cards' forms — none of them run for the default "discord" tab,
// but the module import graph still needs them mocked so the file loads.
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/actions/api-keys', () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}))
vi.mock('@/lib/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/lib/actions/notion', () => ({ saveNotionConnectionAction: vi.fn(), deleteNotionConnectionAction: vi.fn() }))
vi.mock('@/lib/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  deleteDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(),
  removeDiscordGuildAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(),
  deleteSlackIntegrationAction: vi.fn(),
  saveTelegramIntegrationAction: vi.fn(),
  deleteTelegramIntegrationAction: vi.fn(),
  saveDiscourseIntegrationAction: vi.fn(),
  deleteDiscourseIntegrationAction: vi.fn(),
  saveEmailIntegrationAction: vi.fn(),
  deleteEmailIntegrationAction: vi.fn(),
  generateGoogleChatConnectCodeAction: vi.fn(),
  saveGoogleChatSettingsAction: vi.fn(),
  deleteGoogleChatIntegrationAction: vi.fn(),
  getCurrentDeploymentMode: vi.fn(async () => 'cloud'),
}))
vi.mock('@/lib/actions/invitations', () => ({
  sendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  removeMemberAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}))
vi.mock('@/lib/actions/widget', () => ({
  getWidgetTokenAction: vi.fn(),
  regenerateWidgetTokenAction: vi.fn(),
  saveWidgetOriginsAction: vi.fn(),
}))
vi.mock('@/lib/actions/ai-config', () => ({
  saveAIConfigAction: vi.fn(),
  clearAIConfigAction: vi.fn(),
}))
vi.mock('@/lib/actions/roi', () => ({ saveROIConfigAction: vi.fn() }))
vi.mock('@/lib/actions/account', () => ({
  deleteAccountAction: vi.fn(),
  getCurrentOrgName: vi.fn(async () => null),
}))


describe('IntegrationsPage beta grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
  })

  it('groups Google Chat, Discourse, Circle and Email under a Beta label', () => {
    render(<IntegrationsPage />)

    const beta = screen.getByRole('group', { name: 'Beta integrations' })
    expect(within(beta).getByText('Beta')).toBeTruthy()
    for (const label of ['Google Chat', 'Discourse', 'Circle', 'Email']) {
      expect(within(beta).getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('keeps the established channels and Notion outside the Beta group', () => {
    render(<IntegrationsPage />)

    const beta = screen.getByRole('group', { name: 'Beta integrations' })
    for (const label of ['Discord', 'Slack', 'Telegram', 'GitHub', 'Notion']) {
      const button = screen.getByRole('button', { name: label })
      expect(beta.contains(button), `${label} should not be in the Beta group`).toBe(false)
    }
  })

  it('still opens a beta integration by its tab', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('tab=circle') as unknown as ReturnType<typeof useSearchParams>)
    render(<IntegrationsPage />)

    const circle = within(screen.getByRole('group', { name: 'Beta integrations' })).getByRole('button', { name: 'Circle' })
    expect(circle.className).toContain('bg-[#082e50]')
  })
})
