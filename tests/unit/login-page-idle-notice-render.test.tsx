// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { auth, redirect, loginWithProvider } = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn(),
  loginWithProvider: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth }))
vi.mock('next/navigation', () => ({ redirect }))
// The sign-in form's server action pulls in the full auth stack; the page only
// needs the form to render.
vi.mock('@/lib/actions/auth', () => ({ loginWithProvider }))
vi.mock('@/lib/auth/providers', () => ({
  configuredSignInProviders: () => [{ id: 'google', label: 'Google' }],
}))

import LoginPage from '@/app/login/page'

const IDLE_NOTICE = /you were signed out after a period of inactivity/i

async function renderLogin(params: Record<string, string>) {
  const element = await LoginPage({ searchParams: Promise.resolve(params) })
  return render(element)
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(null)
  redirect.mockReset()
  loginWithProvider.mockReset()
})

describe('Login page idle sign-out notice', () => {
  it('explains the sign-out when the idle timer sent the visitor here', async () => {
    await renderLogin({ signedOut: 'idle' })
    const notice = screen.getByRole('status')
    expect(notice.textContent).toMatch(IDLE_NOTICE)
    expect(notice.textContent).toMatch(/sign in again to continue/i)
    // The sign-in button is still offered alongside the notice.
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('shows no notice on an ordinary visit', async () => {
    await renderLogin({})
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(IDLE_NOTICE)).toBeNull()
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeTruthy()
  })

  it('shows the sign-in error instead of the notice when both are present', async () => {
    await renderLogin({ signedOut: 'idle', error: 'OAuthCallback' })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(IDLE_NOTICE)).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/sign-in was cancelled or failed/i)
  })

  it.each(['true', 'manual', 'IDLE', ''])(
    'shows no notice for signedOut=%j, which the idle timer never sends',
    async (value) => {
      await renderLogin({ signedOut: value })
      expect(screen.queryByRole('status')).toBeNull()
      expect(screen.queryByText(IDLE_NOTICE)).toBeNull()
    },
  )
})
