// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import { TrialEndingBanner } from '@/components/dashboard/trial-ending-banner'
import { trialDaysLeft } from '@/lib/billing/trial'

describe('TrialEndingBanner', () => {
  it('says how many days are left and links straight to checkout', () => {
    render(<TrialEndingBanner daysLeft={3} />)
    expect(screen.getByText(/ends in 3 days/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Choose a plan' }).getAttribute('href')).toBe('/checkout')
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('turns urgent for the last day', () => {
    render(<TrialEndingBanner daysLeft={1} />)
    expect(screen.getByRole('alert').textContent).toMatch(/within a day/i)
  })

  it('tells them no card is on file', () => {
    render(<TrialEndingBanner daysLeft={2} />)
    expect(screen.getByText(/no card is on file/i)).toBeTruthy()
  })
})

describe('when the banner applies', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  const trial = (ms: number) => ({
    status: 'trialing',
    stripeSubscriptionId: null,
    trialEndsAt: new Date(now.getTime() + ms).toISOString(),
  })
  const DAY = 86_400_000

  it('counts whole days left, rounding the last partial day up', () => {
    expect(trialDaysLeft(trial(3 * DAY), now)).toBe(3)
    expect(trialDaysLeft(trial(2.2 * DAY), now)).toBe(3)
    expect(trialDaysLeft(trial(0.2 * DAY), now)).toBe(1)
    expect(trialDaysLeft(trial(-DAY), now)).toBe(0)
  })

  it('is not a trial for a paid plan or a card-backed Stripe trial', () => {
    expect(trialDaysLeft({ status: 'active', stripeSubscriptionId: null, trialEndsAt: null }, now)).toBeNull()
    expect(trialDaysLeft({ status: 'trialing', stripeSubscriptionId: 'sub_1', trialEndsAt: trial(DAY).trialEndsAt }, now)).toBeNull()
  })

  it('is mounted in the dashboard layout for the last three days only', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/layout.tsx'), 'utf-8')
    expect(src).toContain('trialDays > 0 && trialDays <= TRIAL_WARNING_DAYS')
    expect(src).toContain('<TrialEndingBanner daysLeft={trialEnding} />')
  })
})
