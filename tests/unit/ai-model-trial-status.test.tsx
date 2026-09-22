// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AIModelSection } from '@/app/(dashboard)/settings/page'

// Covers the new logic in AIModelSection: it now fetches
// /api/ai-config/trial-status alongside /api/ai-config and shows the
// user where they stand — "N of 5 free AI-answered tickets left" while
// trial credits remain, "used up" once exhausted, and unaffected when the
// org already has its own key or is self-hosted (route returns null).

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

// settings/page.tsx imports every action module at the top of the file
// regardless of which section uses it, and @/lib/actions/account
// transitively imports @/auth (next-auth), which fails to resolve outside
// a full Next.js runtime — same fix as tests/unit/api-keys-section.test.tsx.
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
  saveEmailIntegrationAction: vi.fn(),
  deleteEmailIntegrationAction: vi.fn(),
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

function mockFetchSequence(aiConfig: unknown, trialStatus: unknown) {
  global.fetch = vi.fn((url: string) => {
    const body = url.includes('trial-status') ? trialStatus : aiConfig
    return Promise.resolve({ json: () => Promise.resolve(body) } as Response)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AIModelSection — free AI trial status', () => {
  it('shows remaining trial count when the org has no key and trial credits remain', async () => {
    mockFetchSequence(null, { used: 2, limit: 5, remaining: 3, exhausted: false })
    render(<AIModelSection />)

    await waitFor(() => {
      expect(screen.getByText(/3 of 5 free AI-answered tickets left/)).toBeInTheDocument()
    })
    expect(screen.getByText('Free trial')).toBeInTheDocument()
  })

  it('shows an exhausted message and badge once the trial is used up', async () => {
    mockFetchSequence(null, { used: 5, limit: 5, remaining: 0, exhausted: true })
    render(<AIModelSection />)

    await waitFor(() => {
      expect(screen.getByText(/Free AI trial used up/)).toBeInTheDocument()
    })
    expect(screen.getByText('Trial used up')).toBeInTheDocument()
  })

  it('falls back to the platform-default message when trial-status is null (self-hosted, or org has a key)', async () => {
    mockFetchSequence(null, null)
    render(<AIModelSection />)

    await waitFor(() => {
      expect(screen.getByText(/Using platform default \(OPENAI_API_KEY from environment\)/)).toBeInTheDocument()
    })
    expect(screen.getByText('Platform default')).toBeInTheDocument()
  })

  it('does not show trial status text once the org has its own configured key', async () => {
    mockFetchSequence(
      { chat_provider: 'openai', chat_model: 'gpt-4o', chat_api_key_set: true },
      { used: 1, limit: 5, remaining: 4, exhausted: false }
    )
    render(<AIModelSection />)

    await waitFor(() => {
      expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/free AI-answered tickets left/)).not.toBeInTheDocument()
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })
})
