// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * When included AI usage runs out part-way through a file, the upload route
 * returns the sections it added together with the reason. The onboarding
 * wizard must show the reason and stay on the step (not say "Continuing…"
 * and move on), and the KB page must still refresh to show what was added.
 */

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  params: { current: new URLSearchParams() },
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => h.params.current,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/app/(dashboard)/kb/review-tab', () => ({ ReviewTab: () => <div /> }))
vi.mock('@/app/(dashboard)/kb/coverage-tab', () => ({ CoverageTab: () => <div /> }))
vi.mock('@/components/dashboard/notion-kb-section', () => ({ NotionKBSection: () => <div /> }))
vi.mock('@/components/dashboard/add-knowledge-section', () => ({ AddKnowledgeSection: () => <div /> }))
vi.mock('@/lib/actions/kb', () => ({ getTicketDraftAction: vi.fn() }))
vi.mock('@/lib/actions/ingest-url', () => ({ ingestUrlAction: vi.fn() }))
vi.mock('@/lib/kb/sync-client', () => ({ runKbSync: vi.fn() }))
vi.mock('@/lib/actions/onboarding', () => ({ updateWorkspaceNameAction: vi.fn(), completeOnboardingAction: vi.fn() }))
vi.mock('@/lib/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(),
}))
vi.mock('@/lib/actions/widget', () => ({ getWidgetTokenAction: vi.fn() }))

vi.stubGlobal('fetch', h.fetchMock)

const PARTIAL = {
  created: 2,
  filename: 'guide.txt',
  sourceId: 3,
  error: 'Added 2 of 5 sections from guide.txt. This workspace has used its included trial AI usage for knowledge-base processing.',
}

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
}

function routeWithUpload(upload: unknown) {
  h.fetchMock.mockImplementation((url: string) => {
    if (url === '/api/kb/upload') return json(upload)
    if (url === '/api/kb/review?limit=0') return json({ counts: { pending: 0 } })
    if (url === '/api/kb' || url === '/api/kb/sources') return json([])
    return json({})
  })
}

const file = () => new File(['some text'], 'guide.txt', { type: 'text/plain' })

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  routeWithUpload(PARTIAL)
})

describe('onboarding Seed KB step', () => {
  it('a partial upload shows the reason and stays on the step', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const onDone = vi.fn()
      const { SeedStep } = await import('@/app/onboarding/wizard')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { container } = render(<SeedStep onDone={onDone} />)
      await user.click(screen.getByRole('button', { name: /Upload file/ }))
      await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file())

      expect(await screen.findByText(PARTIAL.error)).toBeInTheDocument()
      expect(screen.getByText('2 chunks added from guide.txt')).toBeInTheDocument()
      expect(screen.queryByText('Continuing…')).not.toBeInTheDocument()
      await act(async () => { vi.advanceTimersByTime(5000) })
      expect(onDone).not.toHaveBeenCalled()

      // The user moves on when ready.
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a full upload still continues', async () => {
    routeWithUpload({ created: 4, filename: 'guide.txt', sourceId: 3 })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const onDone = vi.fn()
      const { SeedStep } = await import('@/app/onboarding/wizard')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { container } = render(<SeedStep onDone={onDone} />)
      await user.click(screen.getByRole('button', { name: /Upload file/ }))
      await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file())
      expect(await screen.findByText('Continuing…')).toBeInTheDocument()
      await act(async () => { vi.advanceTimersByTime(2000) })
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('KB page file upload', () => {
  it('a partial upload shows the reason and refreshes the article list', async () => {
    const { default: KBPage } = await import('@/app/(dashboard)/kb/page')
    const { container } = render(<KBPage />)
    await waitFor(() => expect(h.fetchMock).toHaveBeenCalledWith('/api/kb/review?limit=0'))
    await act(async () => {})
    const listLoadsBefore = h.fetchMock.mock.calls.filter(([u]) => u === '/api/kb').length

    const user = userEvent.setup()
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file())

    expect(await screen.findByText(PARTIAL.error)).toBeInTheDocument()
    await waitFor(() => {
      expect(h.fetchMock.mock.calls.filter(([u]) => u === '/api/kb').length).toBeGreaterThan(listLoadsBefore)
    })
  })
})
