import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { hasActiveAccess } from '@/lib/billing/plans'
import { tierForStatus } from '@/lib/billing/platform-ai-budget'

// When the trial ends the product locks and a card is needed to continue; the
// AI budget keeps applying while it runs. Plus the structural guarantees that
// no Stripe trial can bypass the ledger.

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('an expired trial', () => {
  it('grants no product access and no AI budget tier', () => {
    expect(hasActiveAccess('trial_expired')).toBe(false)
    expect(tierForStatus('trial_expired')).toBeNull()
  })

  it('a running trial keeps access and stays on the trial AI budget tier', () => {
    expect(hasActiveAccess('trialing')).toBe(true)
    expect(tierForStatus('trialing')).toBe('trial')
  })

  it('every subscription read applies the expiry, so no caller can forget it', () => {
    const src = read('lib/db/queries/billing.ts')
    expect(src).toContain("'trial_expired'")
    expect(src).toMatch(/status: effectiveStatus\(row\)/)
  })
})

describe('paying after the trial', () => {
  it('Stripe checkout sessions carry no trial period', () => {
    const src = read('lib/billing/checkout.ts')
    expect(src).not.toMatch(/trial_period_days\s*:/)
    expect(src).not.toContain('TRIAL_DAYS')
  })

  it('a completed checkout activates only when payment settled, and clears the trial date', () => {
    const src = read('app/api/billing/webhook/route.ts')
    expect(src).toContain("session.payment_status === 'paid'")
    expect(src).toContain("'no_payment_required'")
    expect(src).not.toMatch(/status: 'trialing'/)
    expect(src).toMatch(/trialEndsAt: null/)
  })
})

describe('sign-in guards in auth.ts', () => {
  const src = read('auth.ts')
  it('refuses an unverified provider email', () => {
    expect(src).toContain('email_verified')
    expect(src).toContain('/login?error=EmailNotVerified')
  })
  it('sends anyone without recorded terms to the terms step before billing or onboarding', () => {
    const gate = src.indexOf('!access.termsAcceptedAt && pathname !== ACCEPT_TERMS_PATH')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(src.indexOf('const hasAccess = await orgHasProductAccess'))
    expect(src).toContain("{ error: 'Terms not accepted' }, { status: 403 }")
  })
  it('starts no trial while provisioning a new account, only an existing owner who has accepted the terms', () => {
    expect(src).toContain('existing.role === \'owner\' && user.termsAcceptedAt')
    expect(src).not.toMatch(/insert\(subscriptions\)/)
  })
  it('the terms step is reachable without a subscription', () => {
    expect(read('lib/billing/access.ts')).toContain("'/accept-terms'")
    expect(read('lib/marketing/platform-paths.ts')).toContain("'/accept-terms'")
  })
})
