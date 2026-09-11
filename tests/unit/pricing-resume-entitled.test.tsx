// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * A paying customer clicked "Sign in" and landed on the pricing page, under a
 * banner telling them to pick a plan, directly below a header button offering
 * the dashboard. Two contradictory answers to the same question on one screen.
 *
 * The cause is a question asked too early. getCallbackUrl() chooses the
 * post-OAuth destination before anyone has authenticated, so it cannot know
 * whether this person already has a plan, and sends everyone to
 * /pricing?resume=1. It assumed the access gate would forward the entitled
 * onward from there — but /pricing is in PUBLIC_PATHS, so authorized() returns
 * early and the gate never runs. Nothing moved them on.
 *
 * /pricing is the last place that can finish the redirect, because it is the
 * first place that knows the answer. These tests cover the page side of that
 * loop: that it forwards an entitled visitor, that it does so ONLY for the
 * resume flow, and that the banner never contradicts the header again.
 *
 * The header side — how navState maps to a CTA, and that no-plan renders no
 * dashboard link — is covered in marketing-nav-cta.test.tsx and not repeated.
 */

// redirect() is a control-flow throw in Next, not a function that returns. The
// mock throws the same way, so "the page redirected" and "the page rendered"
// stay mutually exclusive here exactly as they are in production — a mock that
// merely recorded the call would let a broken page render a banner after a
// redirect and still pass.
const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT: ${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    })
  }),
  resolveNavState: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/marketing/nav-state', () => ({ resolveNavState: mocks.resolveNavState }))

import PricingPage from '@/app/pricing/page'
import type { NavState } from '@/components/marketing/chrome'

type Params = { resume?: string; checkout?: string }

/** Renders the async server component's returned tree for one visitor. */
async function renderPricing(state: NavState, params: Params = {}) {
  mocks.resolveNavState.mockResolvedValue(state)
  return render(await PricingPage({ searchParams: Promise.resolve(params) }))
}

/** Invokes the page without rendering, for the cases that should redirect. */
function loadPricing(state: NavState, params: Params = {}) {
  mocks.resolveNavState.mockResolvedValue(state)
  return PricingPage({ searchParams: Promise.resolve(params) })
}

const RESUME_BANNER = /pick a plan to finish setting up/i

beforeEach(() => {
  mocks.redirect.mockClear()
  mocks.resolveNavState.mockReset()
})

describe('a subscriber sent to pricing by the sign-in flow is forwarded on', () => {
  it('redirects ?resume=1 to the dashboard when the plan is active', async () => {
    await expect(loadPricing('active', { resume: '1' })).rejects.toThrow(/NEXT_REDIRECT/)
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard')
  })

  it('renders nothing at all on that path, rather than flashing the pricing page', async () => {
    // The redirect must happen before the tree is built. If it were moved below
    // the return, or downgraded to a client-side effect, this page would still
    // be served to someone who has already paid for what it is selling.
    await expect(loadPricing('active', { resume: '1' })).rejects.toThrow(/NEXT_REDIRECT/)
    expect(document.body.textContent).toBe('')
  })
})

describe('the resume flow itself still works, which is the point of the page', () => {
  it('keeps a signed-in visitor with no plan here and explains why', async () => {
    await renderPricing('no-plan', { resume: '1' })

    expect(mocks.redirect, 'this visitor has nothing to be forwarded to').not.toHaveBeenCalled()
    expect(screen.getByText(RESUME_BANNER)).toBeTruthy()
  })

  it('does not tell a signed-out visitor that they are signed in', async () => {
    // ?resume=1 survives a bookmark, a shared link, or a session that expired
    // between the redirect and the page load. The flag alone is not evidence of
    // a session, so the banner cannot be driven by it alone.
    await renderPricing('anonymous', { resume: '1' })

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(screen.queryByText(RESUME_BANNER)).toBeNull()
    expect(screen.queryByText(/you're signed in/i)).toBeNull()
  })
})

describe('the redirect is scoped to the resume flow, not to /pricing', () => {
  it('lets a subscriber read the pricing page they navigated to deliberately', async () => {
    // A customer comparing plans before an upgrade, or following a link to
    // /pricing from anywhere, must reach the page. Redirecting on navState
    // alone would make the pricing page unreachable for the people most likely
    // to be shopping for a bigger plan.
    await renderPricing('active')

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: /choose a plan for your support volume/i })).toBeTruthy()
  })

  it('does not forward on a resume value other than the one the flow sends', async () => {
    await renderPricing('active', { resume: '0' })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})

describe('a failed checkout is the more urgent message', () => {
  it('shows the failure and suppresses the resume banner for a visitor with no plan', async () => {
    // Both banners describe the same next step from opposite directions.
    // "Pick a plan" stacked under "we couldn't start checkout" reads as advice
    // to do the thing that just failed.
    await renderPricing('no-plan', { resume: '1', checkout: 'failed' })

    expect(screen.getByText(/couldn[’']t start checkout/i)).toBeTruthy()
    expect(screen.queryByText(RESUME_BANNER)).toBeNull()
  })

  it('reassures them that nothing was charged', async () => {
    await renderPricing('no-plan', { checkout: 'failed' })
    expect(screen.getByText(/nothing was charged/i)).toBeTruthy()
  })
})

describe('the page never contradicts the header', () => {
  it('never offers a plan to somebody who already has one', async () => {
    // The guard, stated once for every way an active subscriber can reach this
    // page. Whichever branch changes later, "buy a plan" and "you have a plan"
    // must not appear together.
    for (const params of [{}, { resume: '0' }, { checkout: 'failed' }] as Params[]) {
      const { unmount } = await renderPricing('active', params)
      expect(
        screen.queryByText(RESUME_BANNER),
        `active subscriber told to pick a plan with params ${JSON.stringify(params)}`,
      ).toBeNull()
      unmount()
    }

    // And the one remaining route never renders at all.
    await expect(loadPricing('active', { resume: '1' })).rejects.toThrow(/NEXT_REDIRECT/)
  })

  it('offers the dashboard and nothing else to a subscriber reading the page', async () => {
    await renderPricing('active')

    expect(screen.getByRole('link', { name: /go to dashboard/i })).toBeTruthy()
    expect(screen.queryByText(RESUME_BANNER)).toBeNull()
  })

  it('shows no resume banner to a visitor who did not come through the flow', async () => {
    // The banner narrates a journey. Shown on a cold visit it invents one.
    for (const state of ['anonymous', 'no-plan'] as NavState[]) {
      const { unmount } = await renderPricing(state)
      expect(screen.queryByText(RESUME_BANNER)).toBeNull()
      unmount()
    }
  })
})
