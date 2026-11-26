import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SESSION_IDLE_HOURS,
  sessionIdleHours,
  sessionIdleSeconds,
} from '@/lib/auth/session-lifetime'

describe('sessionIdleHours', () => {
  it('defaults to 8 hours when unset', () => {
    expect(DEFAULT_SESSION_IDLE_HOURS).toBe(8)
    expect(sessionIdleHours({})).toBe(8)
    expect(sessionIdleSeconds({})).toBe(8 * 60 * 60)
  })

  it('reads a whole number of hours from AUTH_SESSION_IDLE_HOURS', () => {
    expect(sessionIdleHours({ AUTH_SESSION_IDLE_HOURS: '4' })).toBe(4)
    expect(sessionIdleHours({ AUTH_SESSION_IDLE_HOURS: ' 12 ' })).toBe(12)
    expect(sessionIdleHours({ AUTH_SESSION_IDLE_HOURS: '1' })).toBe(1)
    expect(sessionIdleHours({ AUTH_SESSION_IDLE_HOURS: '720' })).toBe(720)
    expect(sessionIdleSeconds({ AUTH_SESSION_IDLE_HOURS: '2' })).toBe(7200)
  })

  it.each(['0', '721', '-3', '1.5', 'eight', '', '8h', '1e3'])(
    'falls back to the default for %j instead of failing',
    (value) => {
      expect(sessionIdleHours({ AUTH_SESSION_IDLE_HOURS: value })).toBe(8)
    },
  )
})

describe('auth.ts session config', () => {
  let captured: Record<string, unknown> | undefined

  beforeEach(() => {
    vi.resetModules()
    captured = undefined
    vi.doMock('next-auth', () => ({
      default: (config: Record<string, unknown>) => {
        captured = config
        return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn(), unstable_update: vi.fn() }
      },
    }))
    vi.doMock('next-auth/providers/google', () => ({ default: {} }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.doUnmock('next-auth')
    vi.doUnmock('next-auth/providers/google')
  })

  it('uses JWT sessions that end after 8 idle hours by default, not the library\'s 30 days', async () => {
    vi.stubEnv('AUTH_SESSION_IDLE_HOURS', '')
    await import('@/auth')
    expect(captured?.session).toEqual({ strategy: 'jwt', maxAge: 8 * 60 * 60 })
  })

  it('takes the idle limit from AUTH_SESSION_IDLE_HOURS', async () => {
    vi.stubEnv('AUTH_SESSION_IDLE_HOURS', '3')
    await import('@/auth')
    expect(captured?.session).toEqual({ strategy: 'jwt', maxAge: 3 * 60 * 60 })
  })
})
