import { beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.fn()
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`)
})

vi.mock('@/auth', () => ({ signIn, signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ referer: 'http://localhost:3000/login?plan=standard&interval=annual&code=SOMECODE' }),
}))

beforeEach(() => {
  vi.resetModules()
  signIn.mockReset().mockResolvedValue(undefined)
  redirect.mockClear()
  vi.stubEnv('AUTH_GOOGLE_ID', 'id')
  vi.stubEnv('AUTH_GOOGLE_SECRET', 'secret')
})

describe('loginWithProvider', () => {
  it('starts the flow for a configured method and keeps a promotion code, but not a plan', async () => {
    const { loginWithProvider } = await import('@/lib/actions/auth')
    await loginWithProvider('google')

    // A plan has nothing to buy yet: the trial starts with the account.
    expect(signIn).toHaveBeenCalledWith('google', { redirectTo: '/checkout?code=SOMECODE' })
  })

  it('never reaches the auth library for an unknown method', async () => {
    const { loginWithProvider } = await import('@/lib/actions/auth')
    await expect(loginWithProvider('github')).rejects.toThrow('NEXT_REDIRECT:/login?error=Default')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('never reaches the auth library for a method that is not configured', async () => {
    vi.stubEnv('AUTH_GOOGLE_ID', '')
    const { loginWithProvider } = await import('@/lib/actions/auth')
    await expect(loginWithProvider('google')).rejects.toThrow('NEXT_REDIRECT:/login?error=Default')
    expect(signIn).not.toHaveBeenCalled()
  })
})
