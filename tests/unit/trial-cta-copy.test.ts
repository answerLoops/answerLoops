import { describe, it, expect } from 'vitest'
import { PLANS, TRIAL_DAYS } from '@/lib/billing/plans'
import {
  STANDARD_PRICE_LABEL,
  STANDARD_ANSWERS_LABEL,
  TRIAL_CTA_NOTE,
  INCLUDED_AI_SUMMARY,
} from '@/lib/marketing/plan-summary'

// The trial button needs the answer to "what does this cost and what do I get"
// beside it. Those numbers come from lib/billing/plans.ts, never retyped, so
// the marketing copy cannot drift from what the product charges and allows.

describe('plan summary copy', () => {
  it('names the Standard price from the plan table', () => {
    expect(STANDARD_PRICE_LABEL).toBe(`$${PLANS.standard.priceMonthly / 100}/mo`)
  })

  it('names the Standard answer allowance from the plan table', () => {
    expect(PLANS.standard.deflectionsPerMonth).not.toBeNull()
    expect(STANDARD_ANSWERS_LABEL).toBe(`${PLANS.standard.deflectionsPerMonth!.toLocaleString('en-US')} answers a month`)
  })

  it('keeps the trial length and the no-card promise, and adds the price and answers beside it', () => {
    expect(TRIAL_CTA_NOTE).toContain(`${TRIAL_DAYS} days`)
    expect(TRIAL_CTA_NOTE).toMatch(/no card required/i)
    expect(TRIAL_CTA_NOTE).toContain(STANDARD_PRICE_LABEL)
    expect(TRIAL_CTA_NOTE).toContain(STANDARD_ANSWERS_LABEL)
  })

  it('says included AI usage is separate from the plan allowance and scales with the plan', () => {
    expect(INCLUDED_AI_SUMMARY).toMatch(/separate from your plan/i)
    expect(INCLUDED_AI_SUMMARY).toMatch(/higher plans include more/i)
    expect(INCLUDED_AI_SUMMARY).toContain(STANDARD_ANSWERS_LABEL.replace(' a month', ''))
  })

  it('does not promise any figure for Pro or Enterprise included AI, which have no measured number', () => {
    expect(INCLUDED_AI_SUMMARY).not.toContain(String(PLANS.pro.deflectionsPerMonth!.toLocaleString('en-US')))
  })
})
