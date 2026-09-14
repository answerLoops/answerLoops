// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotionIntegrationCard } from '@/app/(dashboard)/settings/page'
import {
  saveNotionConnectionAction,
  deleteNotionConnectionAction,
} from '@/app/actions/notion'

const { routerRefresh } = vi.hoisted(() => ({ routerRefresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: routerRefresh }),
}))

// SettingsPage's module graph pulls in every settings server-action module.
vi.mock('@/app/actions/api-keys', () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}))
vi.mock('@/app/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/app/actions/notion', () => ({
  saveNotionConnectionAction: vi.fn(),
  deleteNotionConnectionAction: vi.fn(),
}))
vi.mock('@/app/actions/integrations', () => ({
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
vi.mock('@/app/actions/invitations', () => ({
  sendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  removeMemberAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}))
vi.mock('@/app/actions/widget', () => ({
  getWidgetTokenAction: vi.fn(),
  regenerateWidgetTokenAction: vi.fn(),
  saveWidgetOriginsAction: vi.fn(),
}))
vi.mock('@/app/actions/ai-config', () => ({
  saveAIConfigAction: vi.fn(),
  clearAIConfigAction: vi.fn(),
}))
vi.mock('@/app/actions/roi', () => ({ saveROIConfigAction: vi.fn() }))
vi.mock('@/app/actions/account', () => ({
  deleteAccountAction: vi.fn(),
  getCurrentOrgName: vi.fn(async () => null),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function connection(overrides: Record<string, unknown> = {}) {
  return {
    workspace_name: 'Acme HQ',
    kb_last_synced: null,
    kb_chunk_count: 0,
    ...overrides,
  }
}

// sync-kb also starts with "/api/notion", so match it first. Sync is a
// queue-and-poll flow: POST /api/notion/sync-kb enqueues, then
// /api/kb/sync-jobs?kind=notion is polled until it reports a terminal
// status — the mock's job status resolves to "succeeded" immediately so
// tests don't have to wait through the real 2.5s poll interval.
function routeFetch({
  conn = null,
  enqueueError,
  job = { status: 'succeeded', detail: 'Synced 0 chunks from Notion', syncedCount: 0, progress: 0, total: 0 },
}: {
  conn?: unknown
  enqueueError?: string
  job?: { status: string; detail: string | null; syncedCount?: number; progress?: number; total?: number }
} = {}) {
  return vi.fn((url: string) => {
    if (url.startsWith('/api/notion/sync-kb')) {
      if (enqueueError) {
        return Promise.resolve({ ok: false, json: async () => ({ error: enqueueError }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ jobId: 1, status: 'queued', alreadyQueued: false }) })
    }
    if (url.startsWith('/api/kb/sync-jobs')) {
      return Promise.resolve({ ok: true, json: async () => job })
    }
    if (url.startsWith('/api/notion')) {
      return Promise.resolve({ ok: true, json: async () => ({ connection: conn }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('NotionIntegrationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows "Not connected" and the token form when /api/notion returns connection: null', async () => {
    mockFetch.mockImplementation(routeFetch({ conn: null }))
    render(<NotionIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    const input = document.querySelector('input[name="token"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('password')
  })

  it('shows the connected view with the workspace name, "Sync now" and "Disconnect"', async () => {
    mockFetch.mockImplementation(routeFetch({ conn: connection({ kb_chunk_count: 12 }) }))
    render(<NotionIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Connected · Acme HQ')).toBeTruthy())
    expect(screen.getByRole('button', { name: /sync now/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeTruthy()
    expect(screen.queryByText('Not connected')).toBeNull()
  })

  it('submitting the token form calls saveNotionConnectionAction', async () => {
    mockFetch.mockImplementation(routeFetch({ conn: null }))
    vi.mocked(saveNotionConnectionAction).mockResolvedValue(null)

    const user = userEvent.setup()
    render(<NotionIntegrationCard />)

    await waitFor(() => expect(document.querySelector('input[name="token"]')).toBeTruthy())
    await user.type(document.querySelector('input[name="token"]') as HTMLInputElement, 'ntn_test-token')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await waitFor(() => expect(saveNotionConnectionAction).toHaveBeenCalled())
  })

  it('"Sync now" enqueues via POST, polls the job, and toasts its detail message', async () => {
    mockFetch.mockImplementation(
      routeFetch({ conn: connection(), job: { status: 'succeeded', detail: 'Synced 5 chunks from Notion', syncedCount: 5 } }),
    )

    const user = userEvent.setup()
    render(<NotionIntegrationCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: /sync now/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /sync now/i }))

    await waitFor(() => expect(screen.getByText('Synced 5 chunks from Notion')).toBeTruthy())
    expect(mockFetch).toHaveBeenCalledWith('/api/notion/sync-kb', { method: 'POST' })
  })

  it('"Sync now" surfaces a truncated job\'s detail message as-is in the toast', async () => {
    mockFetch.mockImplementation(
      routeFetch({
        conn: connection(),
        job: {
          status: 'succeeded',
          detail: 'Synced 2 chunks from Notion — the knowledge-base article cap was hit, some content was skipped',
          syncedCount: 2,
        },
      }),
    )

    const user = userEvent.setup()
    render(<NotionIntegrationCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: /sync now/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /sync now/i }))

    await waitFor(() =>
      expect(
        screen.getByText('Synced 2 chunks from Notion — the knowledge-base article cap was hit, some content was skipped'),
      ).toBeTruthy(),
    )
  })

  it('"Sync now" toasts the enqueue error when the job fails to queue', async () => {
    mockFetch.mockImplementation(routeFetch({ conn: connection(), enqueueError: 'Could not queue the sync' }))

    const user = userEvent.setup()
    render(<NotionIntegrationCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: /sync now/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /sync now/i }))

    await waitFor(() => expect(screen.getByText('Could not queue the sync')).toBeTruthy())
  })

  it('"Disconnect" calls deleteNotionConnectionAction', async () => {
    mockFetch.mockImplementation(routeFetch({ conn: connection() }))
    vi.mocked(deleteNotionConnectionAction).mockResolvedValue(null)

    const user = userEvent.setup()
    render(<NotionIntegrationCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: /disconnect/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /disconnect/i }))

    await waitFor(() => expect(deleteNotionConnectionAction).toHaveBeenCalled())
  })
})
