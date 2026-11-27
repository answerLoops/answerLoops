// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { AT_BOTTOM_THRESHOLD_PX, isAtBottom, useFollowLatest } from '@/app/widget/[widgetToken]/use-follow-latest'

/**
 * Following the newest message in the widget (use-follow-latest.ts): the view
 * follows new content only while the visitor is at the bottom, offers "Jump to
 * latest" when they have scrolled up and something new arrives, never mistakes
 * its own scrolling for the visitor's, and jumps rather than glides with
 * reduced motion. Scroll measurements are scripted on the element.
 */

interface Metrics {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}

let metrics: Metrics
let scrollTo: ReturnType<typeof vi.fn<(opts?: ScrollToOptions | number) => void>>

function Harness({ content, streaming = false }: { content: number; streaming?: boolean }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const { showJump, jumpToLatest, followNow } = useFollowLatest(el, content, streaming)
  return (
    <div>
      <div
        ref={(node) => {
          if (node && node !== el) {
            Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight })
            Object.defineProperty(node, 'clientHeight', { configurable: true, get: () => metrics.clientHeight })
            Object.defineProperty(node, 'scrollTop', {
              configurable: true,
              get: () => metrics.scrollTop,
              set: (v: number) => (metrics.scrollTop = v),
            })
            node.scrollTo = (opts?: ScrollToOptions | number) => scrollTo(opts)
            setEl(node)
          }
        }}
        data-testid="thread"
      />
      {showJump && (
        <button type="button" onClick={jumpToLatest}>
          Jump to latest
        </button>
      )}
      <button type="button" onClick={followNow}>
        send
      </button>
    </div>
  )
}

const thread = () => screen.getByTestId('thread')
const jump = () => screen.queryByRole('button', { name: 'Jump to latest' })

/** The visitor scrolls the thread to `top`. */
function userScrollsTo(top: number) {
  fireEvent.wheel(thread())
  metrics.scrollTop = top
  fireEvent.scroll(thread())
}

beforeEach(() => {
  metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 }
  // Like a browser, scrolling to the bottom lands exactly there.
  scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
    metrics.scrollTop = Math.min(typeof opts === "object" ? (opts.top ?? 0) : 0, metrics.scrollHeight - metrics.clientHeight)
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isAtBottom', () => {
  it(`counts anything within ${AT_BOTTOM_THRESHOLD_PX}px of the end as the bottom`, () => {
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })).toBe(true)
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 - AT_BOTTOM_THRESHOLD_PX })).toBe(true)
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 - AT_BOTTOM_THRESHOLD_PX - 1 })).toBe(false)
  })
})

describe('useFollowLatest', () => {
  it('follows new content while the visitor is at the bottom: smoothly when idle, instantly while streaming', () => {
    const { rerender } = render(<Harness content={1} />)
    scrollTo.mockClear()
    metrics.scrollHeight = 1100
    rerender(<Harness content={2} />)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: 'smooth' })

    metrics.scrollHeight = 1200
    rerender(<Harness content={3} streaming />)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1200, behavior: 'auto' })
    expect(jump()).toBeNull()
  })

  it('leaves a visitor who scrolled up where they are, and offers Jump to latest when something new arrives', () => {
    const { rerender } = render(<Harness content={1} streaming />)
    userScrollsTo(100)
    expect(jump()).toBeNull() // nothing new yet
    scrollTo.mockClear()

    metrics.scrollHeight = 1100
    rerender(<Harness content={2} streaming />)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(metrics.scrollTop).toBe(100)
    expect(jump()).not.toBeNull()
  })

  it('Jump to latest scrolls to the bottom and goes away', () => {
    const { rerender } = render(<Harness content={1} />)
    userScrollsTo(100)
    metrics.scrollHeight = 1100
    rerender(<Harness content={2} />)
    fireEvent.click(jump()!)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: 'smooth' })
    expect(jump()).toBeNull()
  })

  it('also goes away when the visitor scrolls back to the bottom by hand, and following resumes', () => {
    const { rerender } = render(<Harness content={1} />)
    userScrollsTo(100)
    metrics.scrollHeight = 1100
    rerender(<Harness content={2} />)
    expect(jump()).not.toBeNull()

    userScrollsTo(700)
    expect(jump()).toBeNull()
    scrollTo.mockClear()
    metrics.scrollHeight = 1200
    rerender(<Harness content={3} />)
    expect(scrollTo).toHaveBeenCalled()
  })

  it('brings the view down for the visitor’s own message even when they had scrolled up', () => {
    const { rerender } = render(<Harness content={1} />)
    userScrollsTo(100)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }))
    })
    metrics.scrollHeight = 1100
    rerender(<Harness content={2} />)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: 'smooth' })
    expect(jump()).toBeNull()
  })

  it('does not mistake its own smooth scroll, still on its way, for the visitor scrolling up', () => {
    // A smooth scroll that has not arrived yet: the browser reports positions in between.
    scrollTo = vi.fn((_opts?: ScrollToOptions | number) => {})
    const { rerender } = render(<Harness content={1} />)
    metrics.scrollHeight = 1100
    rerender(<Harness content={2} />)
    metrics.scrollTop = 650 // mid-animation, short of the bottom
    fireEvent.scroll(thread())

    metrics.scrollHeight = 1200
    rerender(<Harness content={3} />)
    expect(jump()).toBeNull()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1200, behavior: 'smooth' })
  })

  it('jumps instead of gliding when the device asks for reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
    const { rerender } = render(<Harness content={1} />)
    metrics.scrollHeight = 1100
    rerender(<Harness content={2} />)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: 'auto' })
  })

  it('starts listening once the conversation area appears after the first render', () => {
    function Late({ content, show }: { content: number; show: boolean }) {
      const [el, setEl] = useState<HTMLDivElement | null>(null)
      const { showJump } = useFollowLatest(el, content, false)
      return (
        <div>
          {show && (
            <div
              data-testid="thread"
              ref={(node) => {
                if (node && node !== el) {
                  Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight })
                  Object.defineProperty(node, 'clientHeight', { configurable: true, get: () => metrics.clientHeight })
                  Object.defineProperty(node, 'scrollTop', {
                    configurable: true,
                    get: () => metrics.scrollTop,
                    set: (v: number) => (metrics.scrollTop = v),
                  })
                  node.scrollTo = (opts?: ScrollToOptions | number) => scrollTo(opts)
                  setEl(node)
                }
              }}
            />
          )}
          {showJump && <span>jump shown</span>}
        </div>
      )
    }
    const { rerender } = render(<Late content={1} show={false} />)
    rerender(<Late content={1} show />)
    userScrollsTo(100)
    metrics.scrollHeight = 1100
    rerender(<Late content={2} show />)
    expect(metrics.scrollTop).toBe(100)
    expect(screen.getByText('jump shown')).toBeTruthy()
  })

  it('offers nothing when everything fits on screen', () => {
    metrics = { scrollHeight: 300, clientHeight: 400, scrollTop: 0 }
    const { rerender } = render(<Harness content={1} />)
    fireEvent.wheel(thread())
    rerender(<Harness content={2} />)
    expect(jump()).toBeNull()
  })
})
