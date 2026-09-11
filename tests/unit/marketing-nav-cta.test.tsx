// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Nav, navState } from '@/components/marketing/chrome'

/**
 * The marketing header used to decide its call to action from authentication
 * alone. Access is scoped to a subscription, so those are different questions:
 * somebody who has signed in without choosing a plan is authenticated and still
 * cannot enter the product.
 *
 * The result was a loop. The header offered "Go to dashboard", the access gate
 * returned them to /pricing?resume=1, and the header offered the same door
 * again — with nothing on screen explaining why they kept arriving back.
 *
 * What matters below is the negative case: in the no-plan state there must be
 * no link to the dashboard at all.
 */

describe('navState', () => {
  it('maps the three real situations', () => {
    expect(navState(false, false)).toBe('anonymous')
    expect(navState(true, false)).toBe('no-plan')
    expect(navState(true, true)).toBe('active')
  })

  it('treats access without a session as anonymous rather than trusting it', () => {
    // Not reachable through resolveNavState, but the type allows it and the
    // safe reading is the one that does not hand out a dashboard link.
    expect(navState(false, true)).toBe('anonymous')
  })
})

describe('the header CTA matches what the visitor can actually do', () => {
  it('offers the dashboard only when the plan is active', () => {
    render(<Nav state="active" />)
    const cta = screen.getByRole('link', { name: /go to dashboard/i })
    expect(cta.getAttribute('href')).toMatch(/\/dashboard$/)
  })

  it('sends a signed-in visitor with no plan to checkout, never to the dashboard', () => {
    render(<Nav state="no-plan" />)

    expect(screen.queryByRole('link', { name: /go to dashboard/i })).toBeNull()
    for (const link of screen.getAllByRole('link')) {
      expect(
        link.getAttribute('href') ?? '',
        'a dashboard link here is a door the access gate immediately closes',
      ).not.toMatch(/\/dashboard$/)
    }

    const cta = screen.getByRole('link', { name: /choose a plan/i })
    expect(cta.getAttribute('href')).toBe('/checkout')
  })

  it('lands the no-plan CTA on checkout, not back out on a marketing page', () => {
    // This visitor is already authenticated, so the journey resumes one step
    // further along than an anonymous one: the only thing between them and the
    // product is a card. /pricing sent them to read about plans again and then
    // travel back; /checkout preselects one and takes the card on the spot.
    render(<Nav state="no-plan" />)
    const cta = screen.getByRole('link', { name: /choose a plan/i })
    expect(cta.getAttribute('href'), 'CTA must move the visitor forward').toBe('/checkout')
  })

  it('names the action instead of describing a state', () => {
    // "Finish setting up" said there was setup in progress somewhere and gave
    // no clue that the next step is picking a plan.
    render(<Nav state="no-plan" />)
    expect(screen.queryByRole('link', { name: /finish setting up/i })).toBeNull()
  })

  it('serves both the new visitor and the returning one, since it cannot tell them apart', () => {
    // This state covers a brand-new visitor and a returning one whose session
    // expired, and nothing distinguishes them before they authenticate. A
    // single button had to pick a side and mislead the other: "Sign in" tells
    // a new visitor they need an account first, "Create account" tells a
    // returning one they are about to make a second.
    //
    // Two buttons answer both. What must not regress is either one going
    // missing, or the trial button pointing somewhere that cannot start one.
    render(<Nav state="anonymous" />)

    const trial = screen.getByRole('link', { name: /start for \$0/i })
    expect(
      trial.getAttribute('href'),
      'the trial is free, so the plan is a small decision and belongs after auth, not before it',
    ).toBe('/login')

    const signIn = screen.getByRole('link', { name: /^log in$/i })
    expect(
      signIn.getAttribute('href'),
      'returning users must land on the sign-in framing, not "Create your account"',
    ).toBe('/login?mode=signin')

    expect(screen.queryByRole('link', { name: /go to dashboard/i })).toBeNull()
  })

  it('never leaves a signed-out visitor with only one of the two doors', () => {
    // The regression this guards is subtle: removing either button still
    // renders a perfectly reasonable-looking header, and the loss only shows
    // up as the half of visitors who quietly leave.
    render(<Nav state="anonymous" />)
    expect(screen.queryByRole('link', { name: /start for \$0/i })).not.toBeNull()
    expect(screen.queryByRole('link', { name: /^log in$/i })).not.toBeNull()
  })

  it('does not send a signed-out visitor to a source repository from the header', () => {
    // The header's job is to get someone into the product. A GitHub link beside
    // the CTA competed with it at the point of decision and sent the clicks it
    // won out of the funnel entirely.
    render(<Nav state="anonymous" />)
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/github\.com/i)
    }
  })

  it('no longer advertises early access, which closed when signup opened', () => {
    for (const state of ['anonymous', 'no-plan', 'active'] as const) {
      const { unmount } = render(<Nav state={state} />)
      expect(screen.queryByText(/early access/i)).toBeNull()
      unmount()
    }
  })
})

describe('the header fits the narrowest phones', () => {
  it('keeps the logo mark itself at every width', () => {
    const { container } = render(<Nav state="no-plan" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})

describe('the plan cards the header CTA points at', () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf-8')

  it('has an anchor for the header CTA to land on', () => {
    // Without the id the hash is inert and the CTA silently degrades back to
    // "reload /pricing".
    expect(read('app/pricing/page.tsx')).toContain('id="plans"')
  })

  it('clears the sticky header so the cards are not hidden under it', () => {
    const src = read('app/pricing/page.tsx')
    const section = src.slice(src.indexOf('id="plans"'), src.indexOf('id="plans"') + 200)
    expect(section).toMatch(/scroll-mt-/)
  })

  it('carries the billing period through sign-in, not just the plan', () => {
    // The pricing cards link to /login?plan=..&interval=.. . An already
    // signed-in visitor is redirected straight on to /start-trial, which
    // defaults to monthly when no interval arrives — so dropping it here bills
    // the monthly price to someone who clicked an annual card.
    const src = read('app/login/page.tsx')
    expect(src).toContain('parseBillingInterval')
    expect(src).toMatch(/interval=\$\{parsed\}/)
  })
})
