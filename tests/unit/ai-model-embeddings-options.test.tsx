// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIModelSection } from '@/app/(dashboard)/settings/page'
import { testAIConfigAction } from '@/lib/actions/ai-config'

const h = vi.hoisted(() => ({ included: false }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/actions/api-keys', () => ({ createApiKeyAction: vi.fn(), revokeApiKeyAction: vi.fn() }))
vi.mock('@/lib/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/lib/actions/notion', () => ({ saveNotionConnectionAction: vi.fn(), deleteNotionConnectionAction: vi.fn() }))
vi.mock('@/lib/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(), deleteDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(), removeDiscordGuildAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(), deleteSlackIntegrationAction: vi.fn(),
  saveTelegramIntegrationAction: vi.fn(), deleteTelegramIntegrationAction: vi.fn(),
  saveEmailIntegrationAction: vi.fn(), deleteEmailIntegrationAction: vi.fn(),
}))
vi.mock('@/lib/actions/invitations', () => ({
  sendInviteAction: vi.fn(), revokeInviteAction: vi.fn(), removeMemberAction: vi.fn(), transferOwnershipAction: vi.fn(),
}))
vi.mock('@/lib/actions/widget', () => ({ getWidgetTokenAction: vi.fn(), regenerateWidgetTokenAction: vi.fn() }))
vi.mock('@/lib/actions/ai-config', () => ({
  saveAIConfigAction: vi.fn(async () => null),
  clearAIConfigAction: vi.fn(async () => null),
  testAIConfigAction: vi.fn(),
  includedEmbeddingsAvailableAction: vi.fn(async () => h.included),
}))
vi.mock('@/lib/actions/roi', () => ({ saveROIConfigAction: vi.fn() }))
vi.mock('@/lib/actions/account', () => ({ deleteAccountAction: vi.fn(), getCurrentOrgName: vi.fn(async () => null) }))

beforeEach(() => {
  vi.clearAllMocks()
  h.included = false
  global.fetch = vi.fn((url: string) =>
    Promise.resolve({ json: () => Promise.resolve(url.includes('usage-status') ? null : null) } as Response),
  ) as unknown as typeof fetch
})

// The Embeddings part of Settings → AI Model says plainly that OpenAI is the
// only provider for knowledge-base processing today. On a hosted plan with
// included AI usage the OpenAI embedding key is optional for other chat
// providers; without included usage it stays required.

async function pickChatProvider(value: string) {
  const user = userEvent.setup()
  render(<AIModelSection />)
  await waitFor(() => expect(screen.getByRole('button', { name: /test connection/i })).toBeTruthy())
  await user.selectOptions(screen.getAllByRole('combobox')[0], value)
  return user
}

describe('AIModelSection — Embeddings', () => {
  it('says OpenAI is the only embedding provider and that Gemini and Mistral are coming soon', async () => {
    await pickChatProvider('openai')
    expect(screen.getByText(/OpenAI is the only provider that can handle knowledge-base processing/)).toBeTruthy()
    expect(screen.getByText(/Google Gemini and Mistral are coming soon/)).toBeTruthy()
  })

  it('marks the OpenAI embedding key optional when included usage covers the knowledge base', async () => {
    h.included = true
    await pickChatProvider('anthropic')
    await waitFor(() => expect(screen.getByText(/OpenAI API key for embeddings \(optional\)/)).toBeTruthy())
    expect(screen.getByText(/Leave blank to use included AI usage/)).toBeTruthy()
  })

  it('keeps the OpenAI embedding key required without included usage', async () => {
    h.included = false
    await pickChatProvider('anthropic')
    expect(screen.getByText(/OpenAI API key for embeddings/)).toBeTruthy()
    expect(screen.queryByText(/\(optional\)/)).toBeNull()
    expect(screen.getByText(/Required: Anthropic can't handle knowledge-base processing/)).toBeTruthy()
  })

  it('shows the note from Test connection when the knowledge base will use included usage', async () => {
    vi.mocked(testAIConfigAction).mockResolvedValue({
      result: { chat: { ok: true }, embedding: { ok: true, note: 'knowledge-base processing will use included AI usage.' } },
    })
    const user = await pickChatProvider('openai')
    await user.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(screen.getByText(/knowledge-base processing will use included AI usage\./)).toBeTruthy())
  })
})
