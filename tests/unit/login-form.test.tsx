// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { loginWithProvider } = vi.hoisted(() => ({ loginWithProvider: vi.fn() }))
vi.mock('@/lib/actions/auth', () => ({ loginWithProvider }))

import { LoginForm } from '@/components/auth/login-form'

const GOOGLE = [{ id: 'google' as const, label: 'Google' }]

beforeEach(() => {
  loginWithProvider.mockReset().mockResolvedValue(undefined)
})

describe('LoginForm — sign up', () => {
  it('shows consent, checked by default, so signing up costs no extra click', () => {
    render(<LoginForm providers={GOOGLE} />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe('/terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy')
    expect((screen.getByRole('button', { name: /sign up with google/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('holds the buttons while consent is withdrawn and releases them when it returns', () => {
    render(<LoginForm providers={GOOGLE} />)
    const button = screen.getByRole('button', { name: /sign up with google/i }) as HTMLButtonElement

    fireEvent.click(screen.getByRole('checkbox'))
    expect(button.disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox'))
    expect(button.disabled).toBe(false)
  })

  it('starts the chosen method on click', async () => {
    render(<LoginForm providers={GOOGLE} />)
    fireEvent.click(screen.getByRole('button', { name: /sign up with google/i }))
    await waitFor(() => expect(loginWithProvider).toHaveBeenCalledWith('google'))
  })

  it('does not start anything while consent is withdrawn', () => {
    render(<LoginForm providers={GOOGLE} />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /sign up with google/i }))
    expect(loginWithProvider).not.toHaveBeenCalled()
  })

  it('shows a pending state and blocks a second click while redirecting', async () => {
    loginWithProvider.mockReturnValue(new Promise(() => {}))
    render(<LoginForm providers={GOOGLE} />)
    fireEvent.click(screen.getByRole('button', { name: /sign up with google/i }))

    const pending = (await screen.findByRole('button', { name: /redirecting/i })) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
  })
})

describe('LoginForm — legal links', () => {
  it('points at the marketing origin when one is given, for both sign up and sign in', () => {
    const base = 'https://answerloops.com'
    const { unmount } = render(<LoginForm providers={GOOGLE} legalBaseUrl={base} />)
    expect(screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe(`${base}/terms`)
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe(`${base}/privacy`)
    unmount()

    render(<LoginForm providers={GOOGLE} legalBaseUrl={base} signingIn />)
    expect(screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe(`${base}/terms`)
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe(`${base}/privacy`)
  })
})

describe('LoginForm — failure', () => {
  it('re-enables the button if starting sign-in fails, rather than leaving it dead', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    loginWithProvider.mockRejectedValueOnce(new Error('boom'))
    render(<LoginForm providers={GOOGLE} />)

    fireEvent.click(screen.getByRole('button', { name: /sign up with google/i }))

    const button = (await screen.findByRole('button', { name: /sign up with google/i })) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    process.off('unhandledRejection', unhandled)
  })
})

describe('LoginForm — sign in', () => {
  it('asks for no checkbox, only states the terms', () => {
    render(<LoginForm providers={GOOGLE} signingIn />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText(/by continuing, you agree/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: /sign in with google/i }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('LoginForm — providers', () => {
  it('renders one button per configured method', () => {
    render(<LoginForm providers={GOOGLE} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('explains an empty list instead of showing a button that cannot work', () => {
    render(<LoginForm providers={[]} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText(/sign-in is not set up on this deployment/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /oauth setup guide/i }).getAttribute('href')).toBe('/docs/self-hosting/oauth')
  })
})
