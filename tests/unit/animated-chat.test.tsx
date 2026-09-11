// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnimatedChat } from '@/components/animated-chat'

let preference: MediaQueryList

function advance(milliseconds: number) {
  act(() => vi.advanceTimersByTime(milliseconds))
}

function setReducedMotion(matches: boolean) {
  Object.defineProperty(preference, 'matches', {
    value: matches,
    configurable: true,
  })
  act(() => preference.dispatchEvent(new Event('change')))
}

beforeEach(() => {
  vi.useFakeTimers()
  preference = Object.assign(new EventTarget(), {
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }) as unknown as MediaQueryList
  vi.spyOn(window, 'matchMedia').mockReturnValue(preference)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('support workflow animation', () => {
  it('reveals sources, drafting, independent review, and delivery in order, then restarts', () => {
    render(<AnimatedChat />)

    expect(
      screen.getByText(/Our webhook retries created duplicate orders/),
    ).toBeVisible()
    expect(screen.getByText('Question received')).toBeVisible()
    expect(
      screen.queryByText('Retrieved from the knowledge base'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Answer agent')).not.toBeInTheDocument()
    expect(screen.queryByText('Review agent')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Reply sent to #integrations'),
    ).not.toBeInTheDocument()

    advance(1799)
    expect(
      screen.queryByText('Retrieved from the knowledge base'),
    ).not.toBeInTheDocument()
    advance(1)
    expect(screen.getByText('Retrieved from the knowledge base')).toBeVisible()
    expect(screen.getByText('Retrieving sources')).toBeVisible()
    expect(screen.queryByText('Answer agent')).not.toBeInTheDocument()

    advance(3000)
    expect(screen.getByText('Answer agent')).toBeVisible()
    expect(screen.getByText('Drafting answer')).toBeVisible()
    expect(screen.queryByText('Review agent')).not.toBeInTheDocument()

    advance(3000)
    expect(screen.getByText('Review agent')).toBeVisible()
    expect(screen.getByText('Reviewing answer')).toBeVisible()
    expect(
      screen.queryByText('Reply sent to #integrations'),
    ).not.toBeInTheDocument()

    advance(3000)
    expect(screen.getByText('Reply sent to #integrations')).toBeVisible()
    expect(screen.getByText('Reply delivered')).toBeVisible()
    advance(6499)
    expect(screen.getByText('Reply sent to #integrations')).toBeVisible()
    advance(1)
    expect(screen.getByText('Question received')).toBeVisible()
    expect(
      screen.queryByText('Retrieved from the knowledge base'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Reply sent to #integrations'),
    ).not.toBeInTheDocument()
  })

  it('cycles the live channel identity from Discord to Telegram to Circle', () => {
    render(<AnimatedChat />)

    expect(screen.getByText('answerLoops / Discord')).toBeVisible()
    advance(1800)
    advance(3000)
    advance(3000)
    advance(3000)
    advance(6500)
    expect(screen.getByText('answerLoops / Telegram')).toBeVisible()
    advance(1800)
    advance(3000)
    advance(3000)
    advance(3000)
    advance(6500)
    expect(screen.getByText('answerLoops / Circle')).toBeVisible()
  })

  it('pauses progression and resumes from the current stage', () => {
    render(<AnimatedChat />)
    advance(1800)
    fireEvent.click(
      screen.getByRole('button', { name: 'Pause example animation' }),
    )
    advance(20000)
    expect(screen.getByText('Retrieving sources')).toBeVisible()
    expect(screen.queryByText('Answer agent')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Play example animation' }),
    )
    advance(3000)
    expect(screen.getByText('Answer agent')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Pause example animation' }),
    ).toBeVisible()
  })

  it('shows the completed example without autoplay controls when reduced motion is preferred', () => {
    setReducedMotion(true)
    render(<AnimatedChat />)
    expect(screen.getByText('Answer agent')).toBeVisible()
    expect(screen.getByText('Review agent')).toBeVisible()
    expect(screen.getByText('Reply sent to #integrations')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
    advance(20000)
    expect(screen.getByText('Reply delivered')).toBeVisible()
  })

  it('responds to reduced-motion preference changes while mounted', () => {
    render(<AnimatedChat />)
    advance(1800)
    setReducedMotion(true)
    expect(screen.getByText('Reply delivered')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)

    setReducedMotion(false)
    expect(screen.getByText('Retrieving sources')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Pause example animation' }),
    ).toBeVisible()
    advance(3000)
    expect(screen.getByText('Drafting answer')).toBeVisible()
  })

  it('suspends the animation while the page is hidden and resumes on return', () => {
    render(<AnimatedChat />)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(20000)
    expect(screen.getByText('Question received')).toBeVisible()

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(1800)
    expect(screen.getByText('Retrieving sources')).toBeVisible()
  })

  it('cleans up its pending animation and event listeners when unmounted', () => {
    const removeMotionListener = vi.spyOn(preference, 'removeEventListener')
    const removeVisibilityListener = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<AnimatedChat />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(removeMotionListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    )
    expect(removeVisibilityListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    )
  })

  it('does not announce repeating illustrative content as live updates', () => {
    render(<AnimatedChat />)
    expect(
      screen
        .getByRole('figure')
        .querySelector('[aria-live], [role="status"], [role="alert"]'),
    ).toBeNull()
  })
})
