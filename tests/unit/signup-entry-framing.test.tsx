// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// The form calls a server action, which reaches auth.ts and the whole next-auth
// runtime. None of that is under test here — the rendered label is.
vi.mock('@/app/actions/auth', () => ({ loginWithGoogle: vi.fn() }))

import { LoginForm } from '@/components/login-form'

/**
 * The front door, for someone who has never been here.
 *
 * Google is the only configured provider, so signing in and signing up run the
 * identical OAuth call — Google creates or reuses the account on its side
 * either way. That makes the wording the entire user-facing difference, and
 * getting it wrong costs real signups in both directions: a new visitor told
 * only "sign in" assumes an account is a prerequisite, and a returning one told
 * only "create an account" wonders whether they are about to make a second.
 */

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('the marketing header speaks to someone with no account', () => {
  it('offers a way to start and a way back in, not just one of them', () => {
    // "anonymous" covers a brand-new visitor and a returning one whose session
    // expired, and nothing can tell them apart before they authenticate. A
    // single button therefore has to guess, and misleads whichever half it
    // guessed wrong about. The header offers both instead. The CTA markup moved
    // into the NavCta client island (so the marketing pages can stay static);
    // marketing-nav-cta.test.tsx renders it and asserts the behaviour — this
    // is the source-level backstop that both labels still exist. The literal
    // strings live in nav-shared.ts (START_LABEL / SIGNIN_LABEL) so the header
    // and drawer can't drift; nav-cta.tsx references them by name.
    const shared = read('components/marketing/nav-shared.ts')
    expect(shared, 'the new visitor needs the trial').toContain('Start trial')
    expect(shared, 'the returning visitor needs the way back in').toMatch(/SIGNIN_LABEL = 'Sign in'/)
    const src = read('components/marketing/nav-cta.tsx')
    expect(src, 'the trial label is wired into the CTA').toContain('START_LABEL')
    expect(src, 'the sign-in label is wired into the CTA').toContain('SIGNIN_LABEL')
  })
})

describe('the login form matches the mode it was opened in', () => {
  it('says sign up by default, because that is who arrives cold', () => {
    render(<LoginForm />)
    expect(screen.getByRole('button', { name: /sign up with google/i })).toBeTruthy()
  })

  it('says sign in when the page is in sign-in mode', () => {
    render(<LoginForm signingIn />)
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeTruthy()
  })

  it('reports its pending state rather than looking dead on click', () => {
    // The OAuth redirect is a full navigation, so the gap between click and
    // Google's page is long enough to look broken without this.
    const src = read('components/login-form.tsx')
    expect(src).toContain('Redirecting…')
    expect(src).toContain('disabled={googlePending}')
  })
})

describe('the login page offers both modes without losing the plan', () => {
  const src = () => read('app/login/page.tsx')

  it('defaults to the create-account framing and offers sign-in as the alternative', () => {
    const s = src()
    expect(s).toContain("mode === 'signin'")
    expect(s).toContain('Create your account')
    expect(s).toContain('Welcome back')
  })

  it('carries plan, interval and callbackUrl across the mode toggle', () => {
    // These three are the only reason this page can send someone into checkout
    // instead of dropping them at pricing. A toggle that drops them turns a
    // chosen annual plan into a generic signup — the same class of bug as the
    // interval being lost on the /login redirect.
    const s = src()
    const carried = s.slice(s.indexOf('const carried'), s.indexOf('const toggleHref'))
    expect(carried).toContain("carried.set('plan'")
    expect(carried).toContain("carried.set('interval'")
    expect(carried).toContain("carried.set('callbackUrl'")
  })

  it('states the trial length from the billing config rather than a hardcoded number', () => {
    // A "14-day trial" hardcoded here silently disagrees with Stripe the day
    // TRIAL_DAYS changes.
    expect(src()).toContain('TRIAL_DAYS')
  })
})

describe('signing in with no plan goes straight to checkout', () => {
  it('does not route through the dashboard or back out to pricing', () => {
    // Signing in does not grant access — a trial needs a card — so /dashboard
    // only bounces off the gate. Pricing was the previous answer and it asked
    // for the plan decision a second time, on a marketing page, after the
    // visitor had already committed by signing in. /checkout is the one screen
    // that can finish the job: it preselects a plan, allows switching, and
    // takes the card.
    const src = read('app/actions/auth.ts')
    const fallback = src.slice(src.indexOf('const cb = url.searchParams'))
    expect(fallback).toContain("return '/checkout'")
    expect(fallback, 'the dashboard fallback is what caused the original detour').not.toContain(
      "return '/dashboard'",
    )
    expect(fallback, 'pricing after auth is the extra step this removed').not.toContain(
      "return '/pricing?resume=1'",
    )
  })

  it('still carries a chosen plan straight through to checkout', () => {
    // Plan choice moved after auth, but the pricing cards still link with
    // ?plan=, and that choice must survive the round trip — landing on the
    // default plan after clicking a specific card is a silent downgrade.
    const src = read('app/actions/auth.ts')
    expect(src).toContain('/checkout?plan=')
    expect(src).toContain('getPlan(requestedPlan)')
  })
})
