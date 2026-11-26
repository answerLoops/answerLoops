import { beforeEach, describe, expect, it, vi } from 'vitest'

const signOut = vi.fn()

vi.mock('@/auth', () => ({ signIn: vi.fn(), signOut }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

beforeEach(() => {
  signOut.mockReset().mockResolvedValue(undefined)
})

describe('logoutAfterIdle', () => {
  it('signs out to the login page, saying why and returning to the open page', async () => {
    const { logoutAfterIdle } = await import('@/lib/actions/auth')
    await logoutAfterIdle('/tickets?status=open')
    expect(signOut).toHaveBeenCalledTimes(1)
    const { redirectTo } = signOut.mock.calls[0][0] as { redirectTo: string }
    const url = new URL(redirectTo, 'http://localhost')
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('signedOut')).toBe('idle')
    expect(url.searchParams.get('callbackUrl')).toBe('/tickets?status=open')
  })

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example/x', 'tickets'])(
    'drops a return address %j that is not a same-site path',
    async (returnTo) => {
      const { logoutAfterIdle } = await import('@/lib/actions/auth')
      await logoutAfterIdle(returnTo)
      expect(signOut).toHaveBeenCalledWith({ redirectTo: '/login?signedOut=idle' })
    },
  )
})
