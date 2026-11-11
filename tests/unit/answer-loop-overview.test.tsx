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

function examplesShown() {
  return [...document.querySelectorAll<HTMLElement>('.loop-example')].map(
    (example) => example.dataset.shown,
  )
}

function pressedRun() {
  return screen
    .getAllByRole('button', { pressed: true })
    .map((button) => button.textContent)
}

// The next timer is only scheduled after React re-renders, so advance one
// step at a time.
function steps(count: number) {
  for (let index = 0; index < count; index += 1) advance(2000)
}

// One full pass: four steps, then the loop stage.
function finishRun() {
  steps(4)
  advance(2600)
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

    advance(2000)
    expect(stepStates()).toEqual(['done', 'active', 'idle', 'idle'])
    advance(2000)
    expect(stepStates()).toEqual(['done', 'done', 'active', 'idle'])
    advance(2000)
    expect(stepStates()).toEqual(['done', 'done', 'done', 'active'])

    advance(2000)
    expect(returnState()).toBe('active')
    // Saved knowledge feeds the next draft, so the docs step lights up again.
    expect(stepStates()).toEqual(['done', 'active', 'done', 'done'])

    advance(2600)
    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])
    expect(returnState()).toBe('idle')
  })

  it('reveals the worked example one step at a time', () => {
    render(<AnswerLoopOverview />)

    expect(examplesShown()).toEqual(['true', 'false', 'false', 'false'])
    expect(
      screen.getByText('Webhook retries made duplicate orders. How do we stop it?'),
    ).toBeVisible()
    const hidden = document.querySelectorAll('.loop-example')[1]
    expect(hidden).toHaveAttribute('aria-hidden', 'true')

    advance(2000)
    expect(examplesShown()).toEqual(['true', 'true', 'false', 'false'])
    expect(hidden).not.toHaveAttribute('aria-hidden')
    expect(screen.getByRole('list', { name: 'Sources used' })).toHaveTextContent(
      '[1] Webhook delivery[2] Idempotency guide',
    )

    steps(2)
    expect(examplesShown()).toEqual(['true', 'true', 'true', 'true'])
    expect(screen.getByText('Posted with 2 cited sources')).toBeVisible()
  })

  it('alternates to the held-back example after each full pass', () => {
    render(<AnswerLoopOverview />)
    expect(pressedRun()).toEqual(['Answered from docs'])

    finishRun()
    expect(pressedRun()).toEqual(['Docs don’t cover it'])
    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])
    expect(
      screen.getByText('Can we rotate our API key with no downtime?'),
    ).toBeVisible()

    steps(3)
    const final = document.querySelectorAll<HTMLElement>('.loop-example')[3]
    expect(final.dataset.tone).toBe('warn')
    expect(final).toHaveTextContent('Held back and sent to your team')

    finishRun()
    expect(pressedRun()).toEqual(['Answered from docs'])
  })

  it('switches examples and restarts from the first step when a run is picked', () => {
    render(<AnswerLoopOverview />)
    steps(2)
    expect(stepStates()).toEqual(['done', 'done', 'active', 'idle'])

    fireEvent.click(screen.getByRole('button', { name: 'Docs don’t cover it' }))
    expect(pressedRun()).toEqual(['Docs don’t cover it'])
    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])
    expect(examplesShown()).toEqual(['true', 'false', 'false', 'false'])
    expect(
      screen.queryByText('Webhook retries made duplicate orders. How do we stop it?'),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Answered from docs' }))
    expect(pressedRun()).toEqual(['Answered from docs'])
    expect(
      screen.getByText('Webhook retries made duplicate orders. How do we stop it?'),
    ).toBeVisible()
  })

  it('stops advancing while paused and resumes on play', () => {
    render(<AnswerLoopOverview />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause diagram animation' }))
    advance(10000)
    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])

    fireEvent.click(screen.getByRole('button', { name: 'Play diagram animation' }))
    advance(2000)
    expect(stepStates()).toEqual(['done', 'active', 'idle', 'idle'])
  })

  it('shows the whole example while paused, including after picking a run', () => {
    render(<AnswerLoopOverview />)
    expect(examplesShown()).toEqual(['true', 'false', 'false', 'false'])

    fireEvent.click(screen.getByRole('button', { name: 'Pause diagram animation' }))
    expect(examplesShown()).toEqual(['true', 'true', 'true', 'true'])
    expect(screen.getByText('Posted with 2 cited sources')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Docs don’t cover it' }))
    expect(pressedRun()).toEqual(['Docs don’t cover it'])
    expect(examplesShown()).toEqual(['true', 'true', 'true', 'true'])
    expect(
      document.querySelectorAll('.loop-example[aria-hidden="true"]'),
    ).toHaveLength(0)
    expect(screen.getByText('No article covers key rotation')).toBeVisible()
    expect(screen.getByText('Held back and sent to your team')).toBeVisible()
    advance(10000)
    expect(stepStates()).toEqual(['active', 'idle', 'idle', 'idle'])

    // Playing again goes back to revealing one step at a time.
    fireEvent.click(screen.getByRole('button', { name: 'Play diagram animation' }))
    expect(examplesShown()).toEqual(['true', 'false', 'false', 'false'])
    advance(2000)
    expect(examplesShown()).toEqual(['true', 'true', 'false', 'false'])
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
    expect(examplesShown()).toEqual(['true', 'true', 'true', 'true'])
    expect(
      screen.queryByRole('button', { name: /diagram animation/ }),
    ).not.toBeInTheDocument()
    advance(20000)
    expect(stepStates()).toEqual(['static', 'static', 'static', 'static'])
    expect(pressedRun()).toEqual(['Answered from docs'])

    // The picker still works without motion, showing the whole example at once.
    fireEvent.click(screen.getByRole('button', { name: 'Docs don’t cover it' }))
    expect(examplesShown()).toEqual(['true', 'true', 'true', 'true'])
    expect(screen.getByText('Held back and sent to your team')).toBeVisible()
  })
  it('pauses when the tab is hidden and resumes when it becomes visible again', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    render(<AnswerLoopOverview />)
    advance(2000)
    expect(stepStates()).toEqual(['done', 'active', 'idle', 'idle'])

    hidden.mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(10000)
    expect(stepStates()).toEqual(['done', 'active', 'idle', 'idle'])

    hidden.mockReturnValue(false)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(2000)
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
    advance(2000)
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
