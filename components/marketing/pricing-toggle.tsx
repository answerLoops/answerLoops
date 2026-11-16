'use client'
import { useState } from 'react'
import Link from 'next/link'
import { START_HREF, TALK_TO_US_HREF } from './nav-shared'
import {
  ANNUAL_DISCOUNT_PCT,
  annualMonthlyPrice,
  annualTotalPrice,
  HIGHLIGHTED_PLAN_ID,
  TRIAL_DAYS,
  type Plan,
} from '@/lib/billing/plans'
import {
  formatPrice,
  isCustomPriced,
  PLAN_COPY,
} from '@/lib/marketing/pricing'
export function PricingToggle({ plans }: { plans: Plan[] }) {
  const [annual, setAnnual] = useState(true)
  return (
    <>
      <div className="pricing-toolbar mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2>Hosted plans</h2>
        <div className="pricing-billing-control flex flex-wrap items-center gap-3 text-sm">
          <span>Monthly</span>
          <button
            type="button"
            role="switch"
            aria-checked={annual}
            aria-label="Use annual billing"
            onClick={() => setAnnual(!annual)}
            className={`relative h-7 w-12 rounded-full ${
              annual ? 'bg-blue-600' : 'bg-slate-400'
            }`}
          >
            <span
              className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                annual ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
          <span>Annual</span>
          <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">
            Save {ANNUAL_DISCOUNT_PCT}%+
          </span>
        </div>
      </div>
      <div className="pricing-plans grid gap-5 lg:grid-cols-3">
        {plans.map((plan, index) => {
          const highlighted = plan.id === HIGHLIGHTED_PLAN_ID
          const copy = PLAN_COPY[plan.id]
          const nextPlan = plans[index + 1]
          const customPriced = isCustomPriced(plan.id)
          return (
            <div
              key={plan.id}
              role="region"
              aria-label={`${plan.name} plan`}
              className={`pricing-plan relative flex flex-col rounded-xl border bg-white p-6 ${
                highlighted
                  ? 'border-blue-600 ring-1 ring-blue-600'
                  : 'border-slate-200'
              }`}
            >
              {/* The badge sits on the card's top edge rather than in its own
                  row, so no card spends height on it and the prices stay on
                  the first screen. */}
              {highlighted && (
                <span className="pricing-plan-badge absolute -top-3 left-6 rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                  Recommended
                </span>
              )}
              <h3>{plan.name}</h3>
              {/* Reserve room for three lines at lg, where the cards are
                  narrowest, and two from xl up, so the trial buttons line up
                  across the three cards at every width. */}
              <p className="mt-2 text-sm text-slate-600 lg:min-h-20 xl:min-h-16">
                {copy.description}
              </p>
              {customPriced ? (
                <>
                  <div className="pricing-amount mt-5">
                    <span className="text-4xl font-semibold tracking-tight">
                      Custom
                    </span>
                    {/* A real space, not just a margin, so the words read as
                        "Custom pricing" to screen readers and crawlers. */}{' '}
                    <span className="text-sm text-slate-600">pricing</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Tailored to your needs.
                  </p>
                </>
              ) : (
                <>
                  <div className="pricing-amount mt-5">
                    <span className="text-4xl font-semibold tracking-tight">
                      {formatPrice(
                        annual ? annualMonthlyPrice(plan) : plan.priceMonthly,
                      )}
                    </span>
                    <span className="ml-1 text-sm text-slate-600">/month</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {annual
                      ? `${formatPrice(annualTotalPrice(plan))} billed annually`
                      : 'Billed monthly'}
                  </p>
                </>
              )}
              <p className="mt-5 border-t border-slate-200 pt-5 font-semibold">
                {plan.deflectionsPerMonth === null
                  ? 'Unlimited AI replies'
                  : `${plan.deflectionsPerMonth.toLocaleString(
                      'en-US',
                    )} estimated AI replies/month`}
              </p>
              {/* Space is only reserved while the cards sit side by side, so
                  their buttons line up: two lines at lg, where the Standard
                  line wraps, and one from xl up where every line fits. Stacked
                  cards need none. */}
              <p className="mt-1 text-sm text-slate-600 lg:min-h-12 xl:min-h-6">
                {plan.overageRatePer100Cents !== null
                  ? `Then ${formatPrice(
                      plan.overageRatePer100Cents,
                    )} per additional 100 replies.`
                  : plan.deflectionsPerMonth === null
                  ? 'No overage charges.'
                  : nextPlan
                  ? `Replies pause at the limit. ${nextPlan.name} includes ${
                      nextPlan.deflectionsPerMonth === null
                        ? 'unlimited'
                        : nextPlan.deflectionsPerMonth.toLocaleString('en-US')
                    }.`
                  : 'Replies pause at the limit.'}
              </p>
              {customPriced ? (
                /* No self-serve checkout for a custom-priced plan; the one
                    action is a conversation. The trial includes every feature
                    whichever card starts it, so nothing is lost by this. */
                <a
                  href={TALK_TO_US_HREF}
                  className="marketing-button marketing-button-secondary mt-5"
                >
                  Talk to us
                </a>
              ) : (
                <Link
                  href={START_HREF}
                  className={`marketing-button mt-5 ${
                    highlighted ? '' : 'marketing-button-secondary'
                  }`}
                >
                  Start {TRIAL_DAYS}-day free trial
                </Link>
              )}
              <ul className="mt-6 space-y-3 border-t border-slate-200 pt-5 text-sm text-slate-600">
                {copy.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true" className="text-blue-700">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </>
  )
}
