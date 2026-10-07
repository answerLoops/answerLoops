// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup, renderHook } from '@testing-library/react'

vi.mock('@/lib/live-events', () => ({ subscribeLiveEvents: () => () => {} }))
vi.mock('@/lib/actions/product-feedback', () => ({ submitProductFeedbackAction: vi.fn() }))

import { useVisualViewport } from '@/components/feedback/use-visual-viewport'
import { FeedbackWidget } from '@/components/feedback/feedback-widget'

type Listener = () => void

function makeViewport(height: number, offsetTop = 0) {
  const listeners: Record<string, Set<Listener>> = { resize: new Set(), scroll: new Set() }
  const vv = {
    height,
    offsetTop,
    addEventListener: vi.fn((type: string, fn: Listener) => listeners[type].add(fn)),
    removeEventListener: vi.fn((type: string, fn: Listener) => listeners[type].delete(fn)),
    emit(type: 'resize' | 'scroll') {
      listeners[type].forEach((fn) => fn())
    },
    count: () => listeners.resize.size + listeners.scroll.size,
  }
  return vv
}

const originalVV = Object.getOwnPropertyDescriptor(window, 'visualViewport')
const originalInner = window.innerHeight

function setVV(value: unknown) {
  Object.defineProperty(window, 'visualViewport', { configurable: true, writable: true, value })
}
function setInner(h: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: h })
}

beforeEach(() => {
  setInner(800)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (originalVV) Object.defineProperty(window, 'visualViewport', originalVV)
  else delete (window as unknown as Record<string, unknown>).visualViewport
  setInner(originalInner)
})

describe('useVisualViewport', () => {
  it('returns null when visualViewport is unsupported', () => {
    setVV(undefined)
    const { result } = renderHook(() => useVisualViewport())
    expect(result.current).toBeNull()
  })

  it('returns height and bottomInset from the visual viewport', () => {
    setVV(makeViewport(500, 20))
    const { result } = renderHook(() => useVisualViewport())
    expect(result.current).toEqual({ height: 500, bottomInset: 280 })
  })

  it('clamps bottomInset at zero', () => {
    setVV(makeViewport(900))
    const { result } = renderHook(() => useVisualViewport())
    expect(result.current).toEqual({ height: 900, bottomInset: 0 })
  })

  it('updates on resize and scroll events', () => {
    const vv = makeViewport(800)
    setVV(vv)
    const { result } = renderHook(() => useVisualViewport())
    expect(result.current?.bottomInset).toBe(0)

    act(() => {
      vv.height = 450
      vv.emit('resize')
    })
    expect(result.current).toEqual({ height: 450, bottomInset: 350 })

    act(() => {
      vv.offsetTop = 100
      vv.emit('scroll')
    })
    expect(result.current).toEqual({ height: 450, bottomInset: 250 })
  })

  it('removes its listeners on unmount', () => {
    const vv = makeViewport(800)
    setVV(vv)
    const { unmount } = renderHook(() => useVisualViewport())
    expect(vv.count()).toBe(2)
    unmount()
    expect(vv.count()).toBe(0)
  })

  it('attaches no listeners and returns null while disabled', () => {
    const vv = makeViewport(800)
    setVV(vv)
    const { result } = renderHook(() => useVisualViewport(false))
    expect(result.current).toBeNull()
    expect(vv.addEventListener).not.toHaveBeenCalled()
  })
})

describe('FeedbackWidget on-screen keyboard handling', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ approvedCount: 0, feedback: [], updates: [] }),
      })),
    )
  })

  it('applies inline maxHeight/bottom only while open and tracks the keyboard', async () => {
    const vv = makeViewport(800)
    setVV(vv)
    render(<FeedbackWidget />)
    const pill = await screen.findByRole('button', { name: /open product feedback/i })
    expect(vv.addEventListener).not.toHaveBeenCalled()

    fireEvent.click(pill)
    const panel = screen.getByRole('dialog', { name: /product feedback/i })
    expect(panel.style.maxHeight).toContain('768px')
    expect(panel.style.bottom).toContain('0px')
    expect(vv.count()).toBe(2)

    // Keyboard opens: visual viewport shrinks to 400px of an 800px window.
    act(() => {
      vv.height = 400
      vv.emit('resize')
    })
    await waitFor(() => expect(panel.style.maxHeight).toContain('368px'))
    expect(panel.style.bottom).toContain('400px')

    // Collapsing removes the listeners and the pill carries no inline style.
    fireEvent.click(screen.getByRole('button', { name: /collapse feedback/i }))
    expect(vv.count()).toBe(0)
    expect(screen.getByRole('button', { name: /open product feedback/i }).getAttribute('style')).toBeNull()
  })

  it('falls back to the class-based sizing when visualViewport is unsupported', async () => {
    setVV(undefined)
    render(<FeedbackWidget />)
    fireEvent.click(await screen.findByRole('button', { name: /open product feedback/i }))
    const panel = screen.getByRole('dialog', { name: /product feedback/i })
    expect(panel.style.maxHeight).toBe('')
    expect(panel.style.bottom).toBe('')
    expect(panel.className).toContain('max-h-[min(42rem,calc(100dvh-2rem))]')
  })
})
