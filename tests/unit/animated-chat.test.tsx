// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnimatedChat } from '@/components/marketing/animated-chat'

let preference: MediaQueryList

function advance(milliseconds: number) {
  act(() => vi.advanceTimersByTime(milliseconds))
}

function completeCycle() {
  for (const duration of [1500, 2000, 2000, 2000, 3500]) advance(duration)
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
      screen.queryByText('Reply sent to #dev-support'),
    ).not.toBeInTheDocument()

    advance(1499)
    expect(
      screen.queryByText('Retrieved from the knowledge base'),
    ).not.toBeInTheDocument()
    advance(1)
    expect(screen.getByText('Retrieved from the knowledge base')).toBeVisible()
    expect(screen.getByText('Retrieving sources')).toBeVisible()
    expect(screen.queryByText('Answer agent')).not.toBeInTheDocument()

    advance(1999)
    expect(screen.queryByText('Answer agent')).not.toBeInTheDocument()
    advance(1)
    expect(screen.getByText('Answer agent')).toBeVisible()
    expect(screen.getByText('Drafting answer')).toBeVisible()
    expect(screen.queryByText('Review agent')).not.toBeInTheDocument()

    advance(1999)
    expect(screen.queryByText('Review agent')).not.toBeInTheDocument()
    advance(1)
    expect(screen.getByText('Review agent')).toBeVisible()
    expect(screen.getByText('Reviewing answer')).toBeVisible()
    expect(
      screen.queryByText('Reply sent to #dev-support'),
    ).not.toBeInTheDocument()

    advance(1999)
    expect(screen.queryByText('Reply sent to #dev-support')).not.toBeInTheDocument()
    advance(1)
    expect(screen.getByText('Reply sent to #dev-support')).toBeVisible()
    expect(screen.getByText('Reply delivered')).toBeVisible()
    advance(3499)
    expect(screen.getByText('Reply sent to #dev-support')).toBeVisible()
    advance(1)
    expect(screen.getByText('Question received')).toBeVisible()
    expect(
      screen.queryByText('Retrieved from the knowledge base'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Reply sent to #dev-support'),
    ).not.toBeInTheDocument()
  })

  it('cycles all three channel examples and wraps back to Discord', () => {
    render(<AnimatedChat />)
    expect(screen.getByText('answerLoops / Discord')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Discord' })).toHaveAttribute('aria-pressed', 'true')
    completeCycle()
    expect(screen.getByText('answerLoops / Telegram')).toBeVisible()
    expect(screen.getByText(/I’m new to the guild/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Telegram' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Discord' })).toHaveAttribute('aria-pressed', 'false')
    completeCycle()
    expect(screen.getByText('answerLoops / Circle')).toBeVisible()
    expect(screen.getByText(/I’m joining the community print swap/)).toBeVisible()
    completeCycle()
    expect(screen.getByText('answerLoops / Discord')).toBeVisible()
    expect(screen.getByText('Question received')).toBeVisible()
  })

  it.each([
    {
      channel: 'Discord', question: /Our webhook retries created duplicate orders/,
      source: 'Webhook delivery', otherSource: 'Idempotency guide',
      answer: /Retries can deliver the same event more than once/,
      step: 'Save the order and a unique event ID in one transaction.',
      review: 'Checked retry behavior and duplicate handling against both sources.',
      destination: '#dev-support',
    },
    {
      channel: 'Telegram', question: /I’m new to the guild/,
      source: 'Guild raid guide', otherSource: 'New member checklist',
      answer: /Start with the raid signup/,
      step: 'Choose your role and review the gear and preparation checklist.',
      review: 'Checked raid signup and preparation steps against both guild guides.',
      destination: 'guild chat',
    },
    {
      channel: 'Circle', question: /I’m joining the community print swap/,
      source: 'Print swap submission guide', otherSource: 'Artwork preparation checklist',
      answer: /Keep your layered original and prepare a separate print-ready export/,
      step: 'Use the printer’s requested color profile and check the soft proof before exporting.',
      review: 'Checked export preparation and submission steps against the print-swap guides.',
      destination: 'the community',
    },
  ])('shows a coherent $channel question, sources, answer, review, and destination', (example) => {
    render(<AnimatedChat />)
    fireEvent.click(screen.getByRole('button', { name: example.channel }))
    expect(screen.getByText(example.question)).toBeVisible()
    expect(screen.queryByText(example.source)).not.toBeInTheDocument()
    advance(1500)
    expect(screen.getByText(example.source)).toBeVisible()
    expect(screen.getByText(example.otherSource)).toBeVisible()
    advance(2000)
    expect(screen.getByText(example.answer)).toBeVisible()
    expect(screen.getByText(example.step)).toBeVisible()
    expect(screen.getByText(`[1] ${example.source}`)).toBeVisible()
    expect(screen.getByText(`[2] ${example.otherSource}`)).toBeVisible()
    advance(2000)
    expect(screen.getByText(example.review)).toBeVisible()
    advance(2000)
    expect(screen.getByText(`Reply sent to ${example.destination}`)).toBeVisible()
  })

  it('resets the stage and pending timer when a different channel is selected', () => {
    render(<AnimatedChat />)
    advance(1500)
    advance(2000)
    advance(1000)
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }))
    expect(screen.getByText('Question received')).toBeVisible()
    expect(screen.queryByText('Answer agent')).not.toBeInTheDocument()
    expect(screen.queryByText(/Our webhook retries/)).not.toBeInTheDocument()
    advance(1499)
    expect(screen.queryByText('Retrieved from the knowledge base')).not.toBeInTheDocument()
    advance(1)
    expect(screen.getByText('Print swap submission guide')).toBeVisible()
  })

  it('restarts the current example when its channel is selected again', () => {
    render(<AnimatedChat />)
    advance(1500)
    advance(2000)
    fireEvent.click(screen.getByRole('button', { name: 'Discord' }))
    expect(screen.getByText('Question received')).toBeVisible()
    expect(screen.queryByText('Answer agent')).not.toBeInTheDocument()
    advance(1500)
    expect(screen.getByText('Retrieving sources')).toBeVisible()
  })

  it('keeps manual channel selection paused until playback resumes', () => {
    render(<AnimatedChat />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause example animation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Telegram' }))
    advance(20000)
    expect(screen.getByText('answerLoops / Telegram')).toBeVisible()
    expect(screen.getByText('Question received')).toBeVisible()
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Play example animation' }))
    advance(1500)
    expect(screen.getByText('Guild raid guide')).toBeVisible()
  })

  it('pauses progression and resumes from the current stage', () => {
    render(<AnimatedChat />)
    advance(1500)
    fireEvent.click(
      screen.getByRole('button', { name: 'Pause example animation' }),
    )
    advance(20000)
    expect(screen.getByText('Retrieving sources')).toBeVisible()
    expect(screen.queryByText('Answer agent')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Play example animation' }),
    )
    advance(2000)
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
    expect(screen.getByText('Reply sent to #dev-support')).toBeVisible()
    expect(screen.queryByRole('button', { name: /example animation/ })).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
    advance(20000)
    expect(screen.getByText('Reply delivered')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }))
    expect(screen.getByText('Reply sent to the community')).toBeVisible()
    expect(screen.getByText(/Keep your layered original/)).toBeVisible()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('responds to reduced-motion preference changes while mounted', () => {
    render(<AnimatedChat />)
    advance(1500)
    setReducedMotion(true)
    expect(screen.getByText('Reply delivered')).toBeVisible()
    expect(screen.queryByRole('button', { name: /example animation/ })).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)

    setReducedMotion(false)
    expect(screen.getByText('Retrieving sources')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Pause example animation' }),
    ).toBeVisible()
    advance(2000)
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
    advance(1500)
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
