// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIModelSection } from '@/app/(dashboard)/settings/page'
import { clearAIConfigAction } from '@/lib/actions/ai-config'

// AIModelSection fetches /api/ai-config/usage-status alongside
// /api/ai-config and shows a workspace without its own key where it stands
// on included AI usage (trial or monthly, used up or not) and which models
// it runs on, read-only. Unaffected when the org has its own key or is
// self-hosted (route returns null). Never shows an amount.

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

function mockFetchSequence(aiConfig: unknown, usageStatus: unknown) {
  global.fetch = vi.fn((url: string) => {
    const body = url.includes('usage-status') ? usageStatus : aiConfig
    return Promise.resolve({ json: () => Promise.resolve(body) } as Response)
  }) as unknown as typeof fetch
}

const models = { chat: 'gpt-5.6-terra', fast: 'gpt-5.6-luna', embedding: 'text-embedding-3-small' }
const ok = { included: true, warning: false, exhausted: false }
const done = { included: true, warning: true, exhausted: true }
const notIncluded = { included: false, warning: false, exhausted: false }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AIModelSection — included AI usage', () => {
  it('describes included usage during the trial and lists the included models', async () => {
    mockFetchSequence(null, { ownChatProvider: false, tier: 'trial', chat: ok, embedding: ok, models })
    render(<AIModelSection />)

    await waitFor(() => {
      expect(screen.getByText(/AI usage is included during your trial\. Add your own provider to remove the limit\./)).toBeInTheDocument()
    })
    expect(screen.getByText('Included')).toBeInTheDocument()
    const row = screen.getByTestId('included-models')
    expect(row).toHaveTextContent('gpt-5.6-terra')
    expect(row).toHaveTextContent('gpt-5.6-luna')
    expect(row).toHaveTextContent('text-embedding-3-small')
  })

  it('describes the monthly limit on a paid plan', async () => {
    mockFetchSequence(null, { ownChatProvider: false, tier: 'plan', chat: ok, embedding: ok, models })
    render(<AIModelSection />)

    await waitFor(() => {
      expect(screen.getByText(/AI usage is included up to a monthly limit\. Add your own provider to remove the limit\./)).toBeInTheDocument()
    })
  })

  it('shows a used-up message and badge once either budget is used up', async () => {
    mockFetchSequence(null, { ownChatProvider: false, tier: 'plan', chat: ok, embedding: done, models })
    render(<AIModelSection />)

    await waitFor(() => {
      expect(screen.getByText(/Included AI usage is used up — add your provider to keep AI features running/)).toBeInTheDocument()
    })
    expect(screen.getByText('Included usage used up')).toBeInTheDocument()
  })

  it('never shows an amount', async () => {
    mockFetchSequence(null, { ownChatProvider: false, tier: 'plan', chat: ok, embedding: ok, models })
    const { container } = render(<AIModelSection />)
    await waitFor(() => expect(screen.getByText('Included')).toBeInTheDocument())
    expect(container.textContent).not.toMatch(/\$\d/)
  })

  it('falls back to the platform-default message when usage-status is null (self-hosted, or org has a key)', async () => {
    mockFetchSequence(null, null)
    render(<AIModelSection />)

    await waitFor(() => {
      expect(screen.getByText(/Using platform default \(OPENAI_API_KEY from environment\)/)).toBeInTheDocument()
    })
    expect(screen.getByText('Platform default')).toBeInTheDocument()
  })

  it('does not show included usage once the org has its own configured key', async () => {
    // An OpenAI key covers answers and embeddings, so usage-status is null.
    mockFetchSequence({ chat_provider: 'openai', chat_model: 'gpt-4o', chat_api_key_set: true }, null)
    render(<AIModelSection />)

    await waitFor(() => {
      expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/AI usage is included/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('included-models')).not.toBeInTheDocument()
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('an own chat key without embeddings: shows that knowledge-base processing is on included usage', async () => {
    mockFetchSequence(
      { chat_provider: 'anthropic', chat_model: 'claude-sonnet-4-6', chat_api_key_set: true },
      { ownChatProvider: true, tier: 'plan', chat: notIncluded, embedding: ok, models }
    )
    render(<AIModelSection />)

    const line = await screen.findByTestId('included-embeddings')
    expect(line).toHaveTextContent('Knowledge-base processing uses included AI usage')
    expect(line).toHaveTextContent('text-embedding-3-small')
    expect(line).toHaveTextContent('Add an OpenAI embedding key under Embeddings to remove the limit.')
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('an own chat key whose included knowledge-base processing is used up: says so', async () => {
    mockFetchSequence(
      { chat_provider: 'anthropic', chat_model: 'claude-sonnet-4-6', chat_api_key_set: true },
      { ownChatProvider: true, tier: 'plan', chat: notIncluded, embedding: done, models }
    )
    render(<AIModelSection />)

    expect(await screen.findByTestId('included-embeddings')).toHaveTextContent(
      'Included knowledge-base processing is used up — add an OpenAI embedding key under Embeddings to keep importing and searching.',
    )
  })

  it('shows "unavailable" for an included model that is not set', async () => {
    mockFetchSequence(null, { ownChatProvider: false, tier: 'plan', chat: ok, embedding: ok, models: { ...models, fast: null } })
    render(<AIModelSection />)

    const row = await screen.findByTestId('included-models')
    expect(row).toHaveTextContent('Fast unavailable')
    expect(row).toHaveTextContent('Chat gpt-5.6-terra')
    expect(row).toHaveTextContent('Embeddings text-embedding-3-small')
  })

  it('fetches usage-status again after resetting to the platform default, and shows included usage', async () => {
    vi.mocked(clearAIConfigAction).mockResolvedValue(null as never)
    mockFetchSequence(
      { chat_provider: 'openai', chat_model: 'gpt-4o', chat_api_key_set: true, embedding_provider: 'openai', embedding_model: 'text-embedding-3-small' },
      { ownChatProvider: false, tier: 'trial', chat: ok, embedding: ok, models }
    )
    const user = userEvent.setup()
    render(<AIModelSection />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Reset to platform default' }))

    await waitFor(() => expect(clearAIConfigAction).toHaveBeenCalled())
    const usageCalls = () =>
      vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url) === '/api/ai-config/usage-status')
    await waitFor(() => expect(usageCalls()).toHaveLength(2))
    expect(await screen.findByTestId('included-models')).toHaveTextContent('gpt-5.6-terra')
    expect(screen.getByText(/AI usage is included during your trial/)).toBeInTheDocument()
    expect(screen.queryByText('Custom')).not.toBeInTheDocument()
  })

  it('does not fetch usage-status again when the reset fails', async () => {
    vi.mocked(clearAIConfigAction).mockResolvedValue({ error: 'Could not reset' } as never)
    mockFetchSequence(
      { chat_provider: 'openai', chat_model: 'gpt-4o', chat_api_key_set: true, embedding_provider: 'openai', embedding_model: 'text-embedding-3-small' },
      { ownChatProvider: false, tier: 'plan', chat: ok, embedding: ok, models }
    )
    const user = userEvent.setup()
    render(<AIModelSection />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Reset to platform default' }))

    expect(await screen.findByText('Could not reset')).toBeInTheDocument()
    const usageCalls = vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url) === '/api/ai-config/usage-status')
    expect(usageCalls).toHaveLength(1)
    expect(screen.queryByTestId('included-models')).not.toBeInTheDocument()
  })
})
