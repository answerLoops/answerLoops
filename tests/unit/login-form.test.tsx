// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { loginWithProvider } = vi.hoisted(() => ({ loginWithProvider: vi.fn() }))
vi.mock('@/lib/actions/auth', () => ({ loginWithProvider }))

import { LoginForm } from '@/components/auth/login-form'

const GOOGLE = [{ id: 'google' as const, label: 'Google' }]
const GITHUB = [{ id: 'github' as const, label: 'GitHub' }]
const BOTH = [
  { id: 'google' as const, label: 'Google' },
  { id: 'github' as const, label: 'GitHub' },
]

beforeEach(() => {
  loginWithProvider.mockReset().mockResolvedValue(undefined)
})

describe('LoginForm', () => {
  it('is one sign-in action for everyone, with no checkboxes to hold it up', () => {
    render(<LoginForm providers={GOOGLE} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    const button = screen.getByRole('button', { name: /sign in with google/i }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })

  it('starts Google method on click', async () => {
    render(<LoginForm providers={GOOGLE} />)
    fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() => expect(loginWithProvider).toHaveBeenCalledWith('google'))
  })

  it('starts GitHub method on click', async () => {
    render(<LoginForm providers={GITHUB} />)
    fireEvent.click(screen.getByRole('button', { name: /sign in with github/i }))
    await waitFor(() => expect(loginWithProvider).toHaveBeenCalledWith('github'))
  })

  it('shows a pending state and blocks a second click while redirecting', async () => {
    loginWithProvider.mockReturnValue(new Promise(() => {}))
    render(<LoginForm providers={BOTH} />)
    fireEvent.click(screen.getByRole('button', { name: /sign in with github/i }))

    const pending = (await screen.findByRole('button', { name: /redirecting/i })) as HTMLButtonElement
    expect(pending.disabled).toBe(true)

    // The other button is also disabled while redirecting
    const googleButton = screen.getByRole('button', { name: /sign in with google/i }) as HTMLButtonElement
    expect(googleButton.disabled).toBe(true)
  })

  it('re-enables the button if starting sign-in fails, rather than leaving it dead', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    loginWithProvider.mockRejectedValueOnce(new Error('boom'))
    render(<LoginForm providers={GITHUB} />)

    fireEvent.click(screen.getByRole('button', { name: /sign in with github/i }))

    const button = (await screen.findByRole('button', { name: /sign in with github/i })) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    process.off('unhandledRejection', unhandled)
  })
})

describe('LoginForm — providers', () => {
  it('renders one button per configured method', () => {
    const { rerender } = render(<LoginForm providers={GOOGLE} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeTruthy()

    rerender(<LoginForm providers={GITHUB} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeTruthy()

    rerender(<LoginForm providers={BOTH} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toContain('Sign in with Google')
    expect(buttons[1].textContent).toContain('Sign in with GitHub')
  })

  it('explains an empty list instead of showing a button that cannot work', () => {
    render(<LoginForm providers={[]} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/sign-in is not set up on this deployment/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /oauth setup guide/i }).getAttribute('href')).toBe('/docs/self-hosting/oauth')
  })
})
