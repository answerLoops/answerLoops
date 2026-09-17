// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// wizard.tsx imports next/navigation and several 'use server' action modules
// at module scope. GitHubFlow itself never touches any of them, but the
// import chain still resolves eagerly (e.g. next-auth via the integrations
// actions), so stub them out rather than let the test load real server code.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/app/actions/onboarding', () => ({
  updateWorkspaceNameAction: vi.fn(),
  completeOnboardingAction: vi.fn(),
}))
vi.mock('@/app/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(),
}))
vi.mock('@/app/actions/ingest-url', () => ({
  ingestUrlAction: vi.fn(),
}))
vi.mock('@/app/actions/widget', () => ({
  getWidgetTokenAction: vi.fn(),
}))

import { GitHubFlow } from '@/app/onboarding/wizard'

// GitHubFlow drives the GitHub App install redirect during onboarding: it
// calls /api/github/install-url, then hard-navigates to the URL the route
// returns. These tests cover the not-yet-connected path (fetch → navigate,
// and the error paths that must NOT navigate) and the already-connected
// confirmation path (renders as a static summary and never calls fetch).

function mockLocation() {
  const original = window.location
  // happy-dom's window.location.href setter performs an actual (no-op, but
  // logged) navigation attempt; replace the whole object so we can assert on
  // it without triggering that, same pattern used for server actions in
  // this suite — delete then redefine as configurable. `any` on both sides
  // sidesteps the DOM lib's special-cased `Location` assignment type.
  // @ts-expect-error - intentionally deleting a non-optional property for the mock
  delete window.location
  ;(window as { location: unknown }).location = { ...original, href: '' }
  return () => {
    ;(window as { location: unknown }).location = original
  }
}

describe('GitHubFlow — not connected', () => {
  let restoreLocation: () => void
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    restoreLocation = mockLocation()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    restoreLocation()
    vi.unstubAllGlobals()
  })

  it('renders the Connect GitHub button', () => {
    render(<GitHubFlow onDone={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument()
  })

  it('fetches the install URL and navigates to it on click', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 'https://github.com/apps/answerloops/installations/new' }), { status: 200 })
    )
    const user = userEvent.setup()
    render(<GitHubFlow onDone={vi.fn()} onBack={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/github/install-url?from=onboarding')
    await waitFor(() => {
      expect(window.location.href).toBe('https://github.com/apps/answerloops/installations/new')
    })
  })

  it('shows the error message and does not navigate when the response has no url', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'GitHub App is not configured for this platform' }), { status: 200 })
    )
    const user = userEvent.setup()
    render(<GitHubFlow onDone={vi.fn()} onBack={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    expect(await screen.findByText('GitHub App is not configured for this platform')).toBeInTheDocument()
    expect(window.location.href).toBe('')
  })

  it('shows a generic error and does not navigate when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const user = userEvent.setup()
    render(<GitHubFlow onDone={vi.fn()} onBack={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    expect(await screen.findByText('Failed to connect to GitHub')).toBeInTheDocument()
    expect(window.location.href).toBe('')
  })
})

describe('GitHubFlow — connected', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the confirmation and calls onDone on Continue, without ever calling fetch', async () => {
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<GitHubFlow onDone={onDone} onBack={vi.fn()} connected />)

    expect(screen.getByText(/GitHub connected/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect GitHub' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue →' }))

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })
})
