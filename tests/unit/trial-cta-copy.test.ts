import { describe, it, expect } from 'vitest'
import { PLANS, TRIAL_DAYS } from '@/lib/billing/plans'
import { TRIAL_CTA_NOTE, INCLUDED_AI_SUMMARY } from '@/lib/marketing/plan-summary'

// Numbers in this copy come from lib/billing/plans.ts, never retyped, so the
// marketing copy cannot drift from what the product charges and allows.

describe('plan summary copy', () => {
  it('keeps the trial note to the trial length and the no-card promise', () => {
    expect(TRIAL_CTA_NOTE).toContain(`${TRIAL_DAYS} days`)
    expect(TRIAL_CTA_NOTE).toMatch(/no card required/i)
    // Prices belong on the pricing page, not under every trial button.
    expect(TRIAL_CTA_NOTE).not.toMatch(/\$\d|\/mo|answers a month/)
  })

  it('says included AI usage is separate from the plan allowance and scales with the plan', () => {
    expect(INCLUDED_AI_SUMMARY).toMatch(/separate from your plan/i)
    expect(INCLUDED_AI_SUMMARY).toMatch(/higher plans include more/i)
    expect(INCLUDED_AI_SUMMARY).toContain(`${PLANS.standard.deflectionsPerMonth!.toLocaleString('en-US')} answers`)
  })

  it('does not promise any figure for Pro or Enterprise included AI, which have no measured number', () => {
    expect(INCLUDED_AI_SUMMARY).not.toContain(String(PLANS.pro.deflectionsPerMonth!.toLocaleString('en-US')))
  })
})
