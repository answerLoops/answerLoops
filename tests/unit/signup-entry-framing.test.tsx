// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// The form calls a server action, which reaches auth.ts and the whole next-auth
// runtime. None of that is under test here — the rendered label is.
vi.mock('@/lib/actions/auth', () => ({ loginWithProvider: vi.fn() }))

import { LoginForm } from '@/components/auth/login-form'

const GOOGLE = [{ id: 'google' as const, label: 'Google' }]

/**
 * The front door, for someone who has never been here.
 *
 * Signing in and signing up run the identical OAuth call — Google creates or reuses the account on its side
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
    expect(shared, 'the returning visitor needs the way back in').toMatch(/SIGNIN_LABEL = 'Log in'/)
    const src = read('components/marketing/nav-cta.tsx')
    expect(src, 'the trial label is wired into the CTA').toContain('START_LABEL')
    expect(src, 'the sign-in label is wired into the CTA').toContain('SIGNIN_LABEL')
  })
})

describe('the login form is one sign-in for everyone', () => {
  it('says sign in, whoever is looking at it', () => {
    render(<LoginForm providers={GOOGLE} />)
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeTruthy()
  })

  it('reports its pending state rather than looking dead on click', () => {
    // The OAuth redirect is a full navigation, so the gap between click and
    // Google's page is long enough to look broken without this.
    const src = read('components/auth/login-form.tsx')
    expect(src).toContain('Redirecting…')
    expect(src).toContain('disabled={pendingId !== null}')
  })
})

describe('the login page is one page for new and returning people', () => {
  const src = () => read('app/login/page.tsx')

  it('has a single framing and no create-account / sign-in toggle', () => {
    const s = src()
    expect(s).toContain('Get started or sign in')
    expect(s).not.toContain("mode === 'signin'")
    expect(s).not.toContain('toggleHref')
  })

  it('carries a promotion code through sign-in', () => {
    expect(src()).toContain('parsePromoCode')
  })

  it('states the trial length from the billing config rather than a hardcoded number', () => {
    // A "14-day trial" hardcoded here silently disagrees with Stripe the day
    // TRIAL_DAYS changes.
    expect(src()).toContain('TRIAL_DAYS')
  })
})

describe('signing in with nowhere in particular to go', () => {
  it('lands on the dashboard, where a new trial starts and an ended one is sent to checkout', () => {
    // A new account is given its card-free trial when it is created, so the
    // dashboard is reachable. An account whose trial is over, or was refused,
    // is sent on to /start-trial and then checkout by the access gate in
    // auth.ts — so the fallback does not need to be checkout itself.
    const src = read('lib/actions/auth.ts')
    const fallback = src.slice(src.indexOf('const cb = url.searchParams'))
    expect(fallback).toContain("return '/dashboard'")
    expect(fallback).not.toContain("return '/pricing?resume=1'")
  })

  it('does not carry a plan through sign-in, since the trial has nothing to buy', () => {
    const src = read('lib/actions/auth.ts')
    expect(src).not.toContain('/checkout?plan=')
    expect(src).not.toContain('getPlan(requestedPlan)')
  })
})
