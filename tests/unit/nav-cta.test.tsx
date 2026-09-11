// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { NavCta } from '@/components/marketing/nav-cta'

/**
 * NavCta is the client island that restores the personalized header/drawer CTA
 * after hydration. Its contract has two halves that are easy to break silently:
 *
 *  - When the caller passes `initialState`, the value is used verbatim and the
 *    `/api/nav-state` round-trip must NOT happen — otherwise a prerendered page
 *    that already resolved the session pays for a fetch it does not need.
 *  - When `initialState` is omitted, the island first paints the anonymous CTA
 *    (so the static HTML is cacheable), then upgrades to whatever the fetch
 *    reports — but only for the three known states, and never regressing away
 *    from anonymous on a failed or garbage response.
 *
 * The drawer variant additionally renders nothing at all unless the state is
 * anonymous, because the drawer only carries the sign-in pair a phone header
 * hides below sm.
 */

const originalFetch = global.fetch

function mockFetchResolving(body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

function mockFetchRejecting() {
  const fn = vi.fn().mockRejectedValue(new Error('network down'))
  global.fetch = fn as unknown as typeof fetch
  return fn
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('NavCta — initialState is used verbatim with no network round-trip', () => {
  it('renders the dashboard link for initialState="active" and never calls fetch', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    render(<NavCta variant="header" initialState="active" />)

    const cta = screen.getByRole('link', { name: /go to dashboard/i })
    expect(cta.getAttribute('href')).toMatch(/\/dashboard$/)

    // Give any stray effect a tick to fire before asserting the negative.
    await Promise.resolve()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('renders "Choose a plan" → /checkout for initialState="no-plan" and no dashboard link', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    render(<NavCta variant="header" initialState="no-plan" />)

    const cta = screen.getByRole('link', { name: /choose a plan/i })
    expect(cta.getAttribute('href')).toBe('/checkout')
    expect(screen.queryByRole('link', { name: /go to dashboard/i })).toBeNull()

    await Promise.resolve()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('NavCta — header, no initialState, upgrades from the fetch', () => {
  it('first paints the anonymous pair, then re-renders to the dashboard link once fetch resolves { state: "active" }', async () => {
    const fetchSpy = mockFetchResolving({ state: 'active' })

    render(<NavCta variant="header" />)

    // First paint: the anonymous CTA, before the fetch has resolved.
    expect(screen.getByRole('link', { name: /start for \$0/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^log in$/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /go to dashboard/i })).toBeNull()

    // After the fetch resolves: upgraded to the active CTA.
    const dashboard = await screen.findByRole('link', { name: /go to dashboard/i })
    expect(dashboard.getAttribute('href')).toMatch(/\/dashboard$/)
    expect(screen.queryByRole('link', { name: /start for \$0/i })).toBeNull()

    expect(fetchSpy).toHaveBeenCalledWith('/api/nav-state', { credentials: 'include' })
  })

  it('stays on the anonymous CTA when the fetch rejects', async () => {
    const fetchSpy = mockFetchRejecting()

    render(<NavCta variant="header" />)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    // Let the rejected promise + .catch settle.
    await Promise.resolve()
    await Promise.resolve()

    expect(screen.getByRole('link', { name: /start for \$0/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^log in$/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /go to dashboard/i })).toBeNull()
  })

  it('stays anonymous when the fetch resolves an unrecognized state', async () => {
    const fetchSpy = mockFetchResolving({ state: 'garbage' })

    render(<NavCta variant="header" />)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    await Promise.resolve()
    await Promise.resolve()

    expect(screen.getByRole('link', { name: /start for \$0/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /go to dashboard/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /choose a plan/i })).toBeNull()
  })
})

describe('NavCta — anonymous CTA labels and contrast', () => {
  it('labels the trial action clearly', () => {
    render(<NavCta variant="header" initialState="anonymous" />)
    expect(screen.getByRole('link', { name: /^start for \$0$/i })).toBeTruthy()
  })

  it('the Sign in link is not styled with white text — it sits on the light header, not a dark one', () => {
    // Regression guard: the secondary CTA was `text-white/80` left over from a
    // dark header and was invisible against `bg-white/90`. See issue #136.
    render(<NavCta variant="header" initialState="anonymous" />)
    const login = screen.getByRole('link', { name: /^log in$/i })
    expect(login.className).not.toMatch(/text-white/)
    expect(login.className).toMatch(/text-slate-(600|700)/)
  })
})

describe('NavCta — drawer variant only renders for the anonymous state', () => {
  it('renders nothing for initialState="active"', () => {
    const { container } = render(<NavCta variant="drawer" initialState="active" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the sign-in + trial pair for initialState="anonymous"', () => {
    render(<NavCta variant="drawer" initialState="anonymous" />)

    const signIn = screen.getByRole('link', { name: /^log in$/i })
    expect(signIn.getAttribute('href')).toBe('/login?mode=signin')

    const trial = screen.getByRole('link', { name: /start for \$0/i })
    expect(trial.getAttribute('href')).toBe('/login')
  })

  it('renders nothing when the fetch reports a non-anonymous state', async () => {
    const fetchSpy = mockFetchResolving({ state: 'no-plan' })

    const { container } = render(<NavCta variant="drawer" />)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    await Promise.resolve()
    await Promise.resolve()

    expect(container).toBeEmptyDOMElement()
  })
})
