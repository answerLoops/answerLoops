// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSearchParams } from 'next/navigation'
import { DiscordIntegrationCard, discordConnectErrorMessage } from '@/components/settings/discord'

// A failed connect used to surface only as a short-lived toast (and, before the
// callback redirected straight to /integrations, not at all). These tests pin
// that the reason stays on screen until dismissed and is readable.

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: () => ({ replace, refresh: vi.fn() }),
}))

vi.mock('@/lib/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  deleteDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(),
  removeDiscordGuildAction: vi.fn(),
  updateDiscordAutoDeflectAction: vi.fn(),
  getCurrentDeploymentMode: vi.fn(async () => 'cloud'),
}))

function mockFetch(inviteUrl?: { ok: boolean; body: unknown }) {
  return vi.fn((url: string) => {
    if (url.startsWith('/api/discord/invite-url') && inviteUrl) {
      return Promise.resolve({ ok: inviteUrl.ok, json: async () => inviteUrl.body })
    }
    return Promise.resolve({ ok: true, json: async () => [] })
  })
}

function setParams(query: string) {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>)
}

describe('DiscordIntegrationCard connect errors', () => {
  beforeEach(() => {
    replace.mockClear()
  })

  it('shows the reason as a persistent alert when the redirect carries discord_error', async () => {
    setParams('tab=discord&discord_error=not_guild_admin')
    vi.stubGlobal('fetch', mockFetch())

    render(<DiscordIntegrationCard />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Manage Server')
    // The error param is cleared from the URL so a refresh does not repeat it,
    // but the message itself stays on screen.
    expect(replace).toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('removes the alert when dismissed', async () => {
    setParams('tab=discord&discord_error=plan_required')
    vi.stubGlobal('fetch', mockFetch())
    const user = userEvent.setup()

    render(<DiscordIntegrationCard />)

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('falls back to a generic message for a code it does not know', async () => {
    setParams('tab=discord&discord_error=something_new')
    vi.stubGlobal('fetch', mockFetch())

    render(<DiscordIntegrationCard />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('did not complete')
    // Never echo an unrecognised code back into the page.
    expect(alert.textContent).not.toContain('something_new')
  })

  it('shows no alert on a successful connect', async () => {
    setParams('tab=discord&discord_connected=1&guild_id=123456789012345678')
    vi.stubGlobal('fetch', mockFetch())

    render(<DiscordIntegrationCard />)

    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an alert when starting the connection fails', async () => {
    setParams('tab=discord')
    vi.stubGlobal('fetch', mockFetch({ ok: false, body: { error: 'Discord integration requires the Standard plan or above' } }))
    const user = userEvent.setup()

    render(<DiscordIntegrationCard />)

    await user.click(await screen.findByRole('button', { name: 'Add answerLoops to Discord' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Standard plan')
  })
})

describe('discordConnectErrorMessage', () => {
  // Every code the callback or the install verification can emit must map to
  // its own message rather than falling through to the generic one.
  const codes = [
    'guild_already_connected',
    'plan_required',
    'forbidden',
    'not_guild_admin',
    'bot_not_in_guild',
    'guild_not_authorized',
    'invalid_state',
    'token_exchange_failed',
    'server_misconfigured',
    'access_denied',
    'cancelled',
    'server_error',
  ]
  const generic = discordConnectErrorMessage('definitely-not-a-code')

  it.each(codes)('has a specific message for %s', (code) => {
    const message = discordConnectErrorMessage(code)
    expect(message).not.toBe(generic)
    // Raw snake_case codes are for logs, never for people.
    if (code.includes('_')) expect(message).not.toContain(code)
  })

  it('covers every error the install verification can return', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'lib/discord/oauth.ts'), 'utf-8')
    const union = src.slice(src.indexOf('type DiscordInstallError'), src.indexOf('type DiscordInstallResult'))
    const emitted = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(emitted.length).toBeGreaterThan(0)
    for (const code of emitted) expect(codes).toContain(code)
  })
})

describe('Discord callback failure logging', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'app/api/discord/callback/route.ts'), 'utf-8')

  it('records every failure reason server-side', () => {
    for (const reason of ["'forbidden'", "'invalid_state'", "'plan_required'", "'guild_already_connected'", 'verified.error']) {
      expect(src).toContain(`rejected(${reason}`)
    }
    expect(src).toContain("rejected(error ?? 'cancelled'")
  })

  it('logs a successful connection with the org and server', () => {
    expect(src).toContain("logger.info('discord server connected'")
  })

  it('never logs the OAuth code or state', () => {
    const loggingLines = src.split('\n').filter((l) => l.includes('rejected(') || l.includes('logger.'))
    for (const line of loggingLines) {
      // As a bare word: the reason string 'invalid_state' is fine, passing the
      // `state` or `code` values themselves is not.
      expect(line).not.toMatch(/\b(state|code)\b/)
    }
  })
})
