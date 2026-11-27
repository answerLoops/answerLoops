import { beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.fn()
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`)
})

let currentReferer = 'http://localhost:3000/login?plan=standard&interval=annual&code=SOMECODE'

vi.mock('@/auth', () => ({ signIn, signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ referer: currentReferer }),
}))

beforeEach(() => {
  vi.resetModules()
  signIn.mockReset().mockResolvedValue(undefined)
  redirect.mockClear()
  currentReferer = 'http://localhost:3000/login?plan=standard&interval=annual&code=SOMECODE'
  vi.stubEnv('AUTH_GOOGLE_ID', 'google-id')
  vi.stubEnv('AUTH_GOOGLE_SECRET', 'google-secret')
  vi.stubEnv('AUTH_GITHUB_ID', 'github-id')
  vi.stubEnv('AUTH_GITHUB_SECRET', 'github-secret')
})

describe('loginWithProvider', () => {
  it('starts the flow for configured Google and keeps a promotion code, but not a plan', async () => {
    const { loginWithProvider } = await import('@/lib/actions/auth')
    await loginWithProvider('google')

    // A plan has nothing to buy yet: the trial starts with the account.
    expect(signIn).toHaveBeenCalledWith('google', { redirectTo: '/checkout?code=SOMECODE' })
  })

  it('starts the flow for configured GitHub and keeps a promotion code', async () => {
    const { loginWithProvider } = await import('@/lib/actions/auth')
    await loginWithProvider('github')

    expect(signIn).toHaveBeenCalledWith('github', { redirectTo: '/checkout?code=SOMECODE' })
  })

  it('preserves same-origin callbackUrl when no promo code is present', async () => {
    currentReferer = 'http://localhost:3000/login?callbackUrl=%2Fdashboard%2Fsettings'
    const { loginWithProvider } = await import('@/lib/actions/auth')
    await loginWithProvider('github')

    expect(signIn).toHaveBeenCalledWith('github', { redirectTo: '/dashboard/settings' })
  })

  it('never reaches the auth library for an unknown method', async () => {
    const { loginWithProvider } = await import('@/lib/actions/auth')
    await expect(loginWithProvider('gitlab')).rejects.toThrow('NEXT_REDIRECT:/login?error=Default')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('never reaches the auth library for an unconfigured Google method', async () => {
    vi.stubEnv('AUTH_GOOGLE_ID', '')
    const { loginWithProvider } = await import('@/lib/actions/auth')
    await expect(loginWithProvider('google')).rejects.toThrow('NEXT_REDIRECT:/login?error=Default')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('never reaches the auth library for an unconfigured GitHub method', async () => {
    vi.stubEnv('AUTH_GITHUB_SECRET', '')
    const { loginWithProvider } = await import('@/lib/actions/auth')
    await expect(loginWithProvider('github')).rejects.toThrow('NEXT_REDIRECT:/login?error=Default')
    expect(signIn).not.toHaveBeenCalled()
  })
})
