// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIModelSection } from '@/app/(dashboard)/settings/page'
import { testAIConfigAction, saveAIConfigAction } from '@/app/actions/ai-config'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/app/actions/api-keys', () => ({ createApiKeyAction: vi.fn(), revokeApiKeyAction: vi.fn() }))
vi.mock('@/app/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/app/actions/notion', () => ({ saveNotionConnectionAction: vi.fn(), deleteNotionConnectionAction: vi.fn() }))
vi.mock('@/app/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(), deleteDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(), removeDiscordGuildAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(), deleteSlackIntegrationAction: vi.fn(),
  saveTelegramIntegrationAction: vi.fn(), deleteTelegramIntegrationAction: vi.fn(),
  saveEmailIntegrationAction: vi.fn(), deleteEmailIntegrationAction: vi.fn(),
}))
vi.mock('@/app/actions/invitations', () => ({
  sendInviteAction: vi.fn(), revokeInviteAction: vi.fn(), removeMemberAction: vi.fn(), transferOwnershipAction: vi.fn(),
}))
vi.mock('@/app/actions/widget', () => ({ getWidgetTokenAction: vi.fn(), regenerateWidgetTokenAction: vi.fn() }))
vi.mock('@/app/actions/ai-config', () => ({
  saveAIConfigAction: vi.fn(async () => null),
  clearAIConfigAction: vi.fn(async () => null),
  testAIConfigAction: vi.fn(),
}))
vi.mock('@/app/actions/roi', () => ({ saveROIConfigAction: vi.fn() }))
vi.mock('@/app/actions/account', () => ({ deleteAccountAction: vi.fn(), getCurrentOrgName: vi.fn(async () => null) }))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn((url: string) =>
    Promise.resolve({ json: () => Promise.resolve(url.includes('trial-status') ? null : null) } as Response),
  ) as unknown as typeof fetch
})

describe('AIModelSection — Test connection', () => {
  it('runs the test action with the form values and shows per-provider results', async () => {
    vi.mocked(testAIConfigAction).mockResolvedValue({
      result: { chat: { ok: true }, embedding: { ok: false, error: 'The API key was rejected (401).' } },
    })
    const user = userEvent.setup()
    render(<AIModelSection />)

    await waitFor(() => expect(screen.getByRole('button', { name: /test connection/i })).toBeTruthy())
    await user.type(screen.getByPlaceholderText('gpt-4o'), 'gpt-4o')
    await user.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(testAIConfigAction).toHaveBeenCalled())
    const fd = vi.mocked(testAIConfigAction).mock.calls[0][1] as FormData
    expect(fd.get('chat_provider')).toBe('openai')
    expect(fd.get('chat_model')).toBe('gpt-4o')

    await waitFor(() => expect(screen.getByText(/connection OK/i)).toBeTruthy())
    expect(screen.getByText(/rejected \(401\)/)).toBeTruthy()
  })

  it('surfaces a validation error from the test action', async () => {
    vi.mocked(testAIConfigAction).mockResolvedValue({ error: 'Fill in the form first' })
    const user = userEvent.setup()
    render(<AIModelSection />)

    await waitFor(() => expect(screen.getByRole('button', { name: /test connection/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(screen.getByText('Fill in the form first')).toBeTruthy())
    expect(saveAIConfigAction).not.toHaveBeenCalled()
  })
})
