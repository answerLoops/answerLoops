// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'

const logoutAfterIdle = vi.fn()
vi.mock('@/lib/actions/auth', () => ({ logoutAfterIdle: (...args: unknown[]) => logoutAfterIdle(...args) }))

import {
  IdleSignOut,
  LAST_ACTIVITY_KEY,
  CHECK_INTERVAL_MS,
  ACTIVITY_WRITE_THROTTLE_MS,
} from '@/components/auth/idle-sign-out'

const HOUR = 60 * 60 * 1000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-26T09:00:00Z'))
  window.localStorage.clear()
  logoutAfterIdle.mockReset().mockResolvedValue(undefined)
  window.history.replaceState(null, '', '/tickets?status=open')
})

afterEach(() => {
  restoreStorage?.()
  restoreStorage = null
  vi.useRealTimers()
})

/**
 * Swaps window.localStorage for a stand-in whose calls can be counted or made
 * to throw. happy-dom's own storage does not route through Storage.prototype,
 * so spying on the prototype would observe nothing.
 */
function replaceLocalStorage(overrides: Partial<Pick<Storage, 'getItem' | 'setItem'>> = {}) {
  const data = new Map<string, string>()
  const fake = {
    getItem: vi.fn(overrides.getItem ?? ((key: string) => data.get(key) ?? null)),
    setItem: vi.fn(overrides.setItem ?? ((key: string, value: string) => { data.set(key, String(value)) })),
    removeItem: vi.fn((key: string) => { data.delete(key) }),
    clear: vi.fn(() => data.clear()),
  }
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
  Object.defineProperty(window, 'localStorage', { configurable: true, value: fake })
  restoreStorage = () => {
    if (original) Object.defineProperty(window, 'localStorage', original)
    else delete (window as { localStorage?: Storage }).localStorage
  }
  return fake
}

let restoreStorage: (() => void) | null = null

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('IdleSignOut', () => {
  it('signs out once after the idle hours pass with no activity, returning to the open page', () => {
    render(<IdleSignOut idleHours={8} />)
    advance(8 * HOUR - CHECK_INTERVAL_MS)
    expect(logoutAfterIdle).not.toHaveBeenCalled()
    advance(CHECK_INTERVAL_MS)
    expect(logoutAfterIdle).toHaveBeenCalledTimes(1)
    expect(logoutAfterIdle).toHaveBeenCalledWith('/tickets?status=open')
    advance(10 * CHECK_INTERVAL_MS)
    expect(logoutAfterIdle).toHaveBeenCalledTimes(1)
  })

  it('treats clicks, typing and scrolling as activity that restarts the clock', () => {
    render(<IdleSignOut idleHours={2} />)
    advance(1.5 * HOUR)
    act(() => { window.dispatchEvent(new Event('pointerdown')) })
    advance(1.5 * HOUR)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })) })
    advance(1.5 * HOUR)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    advance(1.5 * HOUR)
    expect(logoutAfterIdle).not.toHaveBeenCalled()
    advance(0.5 * HOUR)
    expect(logoutAfterIdle).toHaveBeenCalledTimes(1)
  })

  it('stays signed in while another tab records activity', () => {
    render(<IdleSignOut idleHours={2} />)
    advance(1.5 * HOUR)
    // Another dashboard tab writes its activity to shared storage.
    window.localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
    advance(1.5 * HOUR)
    expect(logoutAfterIdle).not.toHaveBeenCalled()
    advance(0.5 * HOUR)
    expect(logoutAfterIdle).toHaveBeenCalledTimes(1)
  })

  it('shares this tab\'s activity with other tabs', () => {
    render(<IdleSignOut idleHours={8} />)
    expect(Number(window.localStorage.getItem(LAST_ACTIVITY_KEY))).toBe(Date.now())
    advance(HOUR)
    act(() => { window.dispatchEvent(new Event('pointerdown')) })
    expect(Number(window.localStorage.getItem(LAST_ACTIVITY_KEY))).toBe(Date.now())
  })

  it('checks as soon as the tab is shown again, since timers stop while a laptop sleeps', () => {
    render(<IdleSignOut idleHours={8} />)
    // Clock jumps forward with no timers firing, as after sleep.
    vi.setSystemTime(Date.now() + 9 * HOUR)
    expect(logoutAfterIdle).not.toHaveBeenCalled()
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(logoutAfterIdle).toHaveBeenCalledTimes(1)
  })

  it('stops listening once unmounted', () => {
    const { unmount } = render(<IdleSignOut idleHours={1} />)
    unmount()
    advance(3 * HOUR)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(logoutAfterIdle).not.toHaveBeenCalled()
  })

  it('records activity to shared storage at most once per throttle window', () => {
    const storage = replaceLocalStorage()
    render(<IdleSignOut idleHours={8} />)
    // Mounting records the page open as activity.
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    storage.setItem.mockClear()
    const setItem = storage.setItem
    advance(ACTIVITY_WRITE_THROTTLE_MS + 1000)
    act(() => { window.dispatchEvent(new Event('pointerdown')) })
    const firstWrite = Date.now()
    advance(10 * 1000)
    act(() => { window.dispatchEvent(new Event('keydown')) })
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(Number(window.localStorage.getItem(LAST_ACTIVITY_KEY))).toBe(firstWrite)
    advance(ACTIVITY_WRITE_THROTTLE_MS)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(setItem).toHaveBeenCalledTimes(2)
    expect(Number(window.localStorage.getItem(LAST_ACTIVITY_KEY))).toBe(Date.now())
  })

  describe('when storage is blocked', () => {
    let storage: ReturnType<typeof replaceLocalStorage>
    beforeEach(() => {
      const blocked = () => {
        throw new DOMException('blocked', 'SecurityError')
      }
      storage = replaceLocalStorage({ getItem: blocked, setItem: blocked })
    })

    it('still signs out after the idle hours pass', () => {
      expect(() => render(<IdleSignOut idleHours={2} />)).not.toThrow()
      expect(storage.setItem).toHaveBeenCalled()
      advance(2 * HOUR - CHECK_INTERVAL_MS)
      expect(logoutAfterIdle).not.toHaveBeenCalled()
      advance(CHECK_INTERVAL_MS)
      expect(storage.getItem).toHaveBeenCalled()
      expect(logoutAfterIdle).toHaveBeenCalledTimes(1)
    })

    it('still counts activity in this tab, so a working user stays signed in', () => {
      render(<IdleSignOut idleHours={2} />)
      advance(1.5 * HOUR)
      expect(() => act(() => { window.dispatchEvent(new Event('pointerdown')) })).not.toThrow()
      expect(storage.setItem.mock.calls.length).toBeGreaterThanOrEqual(2)
      advance(1.5 * HOUR)
      expect(logoutAfterIdle).not.toHaveBeenCalled()
      advance(0.5 * HOUR)
      expect(logoutAfterIdle).toHaveBeenCalledTimes(1)
    })
  })
})
