// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnswerLoopOverview } from '@/components/marketing/answer-loop-overview'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'

let preference: MediaQueryList

function advance(milliseconds: number) {
  act(() => vi.advanceTimersByTime(milliseconds))
}

function stepStates() {
  return [...document.querySelectorAll<HTMLElement>('.loop-step')].map(
    (step) => step.dataset.state,
  )
}

function returnState() {
  return document.querySelector<HTMLElement>('.loop-return')?.dataset.state
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

describe('answer loop overview', () => {
  it('shows the four steps, the return arrow, and every marketed channel', () => {
    render(<AnswerLoopOverview />)

    expect(
      screen.getByRole('heading', { name: 'Good answers start with your knowledge.' }),
    ).toBeVisible()
    for (const title of [
      'Question arrives',
      'Draft from your docs',
      'Check the answer',
      'Reply with confidence',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeVisible()
    }
    expect(screen.getByText('Save useful resolutions as knowledge')).toBeVisible()
    for (const { name, href } of MARKETED_CHANNELS) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
    }
    expect(document.getElementById('integrations')).not.toBeNull()
  })

  it('highlights each step in order, then the loop back into the docs, then restarts', () => {
    render(<AnswerLoopOverview />)

    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])
    expect(returnState()).toBe('idle')

    advance(1800)
    expect(stepStates()).toEqual(['done', 'active', 'idle', 'idle'])
    advance(1800)
    expect(stepStates()).toEqual(['done', 'done', 'active', 'idle'])
    advance(1800)
    expect(stepStates()).toEqual(['done', 'done', 'done', 'active'])

    advance(1800)
    expect(returnState()).toBe('active')
    // Saved knowledge feeds the next draft, so the docs step lights up again.
    expect(stepStates()).toEqual(['done', 'active', 'done', 'done'])

    advance(2600)
    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])
    expect(returnState()).toBe('idle')
  })

  it('stops advancing while paused and resumes on play', () => {
    render(<AnswerLoopOverview />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause diagram animation' }))
    advance(10000)
    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])

    fireEvent.click(screen.getByRole('button', { name: 'Play diagram animation' }))
    advance(1800)
    expect(stepStates()).toEqual(['done', 'active', 'idle', 'idle'])
  })

  it('does not advance while the tab is hidden', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    render(<AnswerLoopOverview />)
    advance(10000)
    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])
  })

  it('renders as a static diagram without highlights or controls under reduced motion', () => {
    render(<AnswerLoopOverview />)
    setReducedMotion(true)

    expect(stepStates()).toEqual(['static', 'static', 'static', 'static'])
    expect(returnState()).toBe('static')
    expect(
      screen.queryByRole('button', { name: /diagram animation/ }),
    ).not.toBeInTheDocument()
    advance(20000)
    expect(stepStates()).toEqual(['static', 'static', 'static', 'static'])
  })
  it('pauses when the tab is hidden and resumes when it becomes visible again', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    render(<AnswerLoopOverview />)
    advance(1800)
    expect(stepStates()).toEqual(['done', 'active', 'idle', 'idle'])

    hidden.mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(10000)
    expect(stepStates()).toEqual(['done', 'active', 'idle', 'idle'])

    hidden.mockReturnValue(false)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(1800)
    expect(stepStates()).toEqual(['done', 'done', 'active', 'idle'])
  })

  it('resumes the animation and shows the pause control when reduced motion is turned off', () => {
    render(<AnswerLoopOverview />)
    setReducedMotion(true)
    expect(stepStates()).toEqual(['static', 'static', 'static', 'static'])

    setReducedMotion(false)
    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])
    expect(returnState()).toBe('idle')
    expect(
      screen.getByRole('button', { name: 'Pause diagram animation' }),
    ).toBeVisible()
    advance(1800)
    expect(stepStates()).toEqual(['done', 'active', 'idle', 'idle'])
  })

  it('leaves no pending timer or listeners behind after unmount', () => {
    const addMotion = vi.spyOn(preference, 'addEventListener')
    const removeMotion = vi.spyOn(preference, 'removeEventListener')
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<AnswerLoopOverview />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
    const motionListener = addMotion.mock.calls.find(([type]) => type === 'change')?.[1]
    expect(motionListener).toBeDefined()
    expect(removeMotion).toHaveBeenCalledWith('change', motionListener)
    const visibilityListener = addDocument.mock.calls.find(
      ([type]) => type === 'visibilitychange',
    )?.[1]
    expect(visibilityListener).toBeDefined()
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', visibilityListener)
  })
})
