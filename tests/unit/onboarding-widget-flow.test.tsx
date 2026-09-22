// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// WidgetFlow fetches a fresh embed token on mount via the getWidgetTokenAction
// server action, renders the <script> snippet the customer pastes into their
// site, and offers a one-click copy. Mock the server action module directly
// (it's a 'use server' export, not a fetch call) so these tests exercise the
// component's own loading/error/copy state machine.
//
// wizard.tsx also imports next/navigation and several other 'use server'
// action modules at module scope; WidgetFlow never touches them, but the
// import chain still resolves eagerly (e.g. next-auth via the integrations
// actions), so stub those out too rather than let the test load real server
// code.

const h = vi.hoisted(() => ({
  getWidgetTokenAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/actions/onboarding', () => ({
  updateWorkspaceNameAction: vi.fn(),
  completeOnboardingAction: vi.fn(),
}))
vi.mock('@/lib/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(),
}))
vi.mock('@/lib/actions/ingest-url', () => ({
  ingestUrlAction: vi.fn(),
}))
vi.mock('@/lib/actions/widget', () => ({
  getWidgetTokenAction: h.getWidgetTokenAction,
}))

import { WidgetFlow } from '@/app/onboarding/wizard'

describe('WidgetFlow', () => {
  beforeEach(() => {
    h.getWidgetTokenAction.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls getWidgetTokenAction on mount and shows a loading state first', async () => {
    let resolveToken: (v: { token?: string; error?: string }) => void
    h.getWidgetTokenAction.mockReturnValue(
      new Promise((resolve) => {
        resolveToken = resolve
      })
    )

    render(<WidgetFlow onDone={vi.fn()} onBack={vi.fn()} />)

    expect(h.getWidgetTokenAction).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Loading…')).toBeInTheDocument()

    resolveToken!({ token: 'tok_abc123' })
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  })

  it('renders the embed script snippet containing the returned token on success', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ token: 'tok_abc123' })

    render(<WidgetFlow onDone={vi.fn()} onBack={vi.fn()} />)

    const snippet = await screen.findByText((_, node) => node?.tagName === 'PRE' && !!node.textContent?.includes('tok_abc123'))
    expect(snippet.textContent).toContain('<script')
    expect(snippet.textContent).toContain('data-widget-id="tok_abc123"')
  })

  it('shows the error text instead of the snippet when the action returns an error', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ error: 'Not authorized to view this widget token' })

    render(<WidgetFlow onDone={vi.fn()} onBack={vi.fn()} />)

    expect(await screen.findByText('Not authorized to view this widget token')).toBeInTheDocument()
    expect(screen.queryByText(/<script/)).not.toBeInTheDocument()
  })

  it('shows a fallback error when the action resolves with no token and no error', async () => {
    h.getWidgetTokenAction.mockResolvedValue({})

    render(<WidgetFlow onDone={vi.fn()} onBack={vi.fn()} />)

    expect(await screen.findByText('Failed to load the widget embed code.')).toBeInTheDocument()
  })

  it('copies the embed code to the clipboard and toggles the Copied state on click', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ token: 'tok_abc123' })
    const user = userEvent.setup()
    // userEvent's setup() installs its own clipboard stub for copy/paste
    // keyboard-shortcut support, overwriting the one from beforeEach — so
    // reinstall ours after setup() and grab a direct reference to assert on.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<WidgetFlow onDone={vi.fn()} onBack={vi.fn()} />)
    await screen.findByRole('button', { name: 'Copy' })

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const written = writeText.mock.calls[0][0] as string
    expect(written).toContain('tok_abc123')
    expect(written).toContain('<script')

    expect(await screen.findByRole('button', { name: '✓ Copied' })).toBeInTheDocument()
  })

  it('calls onDone when Continue is clicked', async () => {
    h.getWidgetTokenAction.mockResolvedValue({ token: 'tok_abc123' })
    const onDone = vi.fn()
    const user = userEvent.setup()

    render(<WidgetFlow onDone={onDone} onBack={vi.fn()} />)
    await screen.findByRole('button', { name: 'Copy' })

    await user.click(screen.getByRole('button', { name: 'Continue →' }))

    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
