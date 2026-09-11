'use client'
import { useState } from 'react'
import Link from 'next/link'
import {
  ANNUAL_DISCOUNT_PCT,
  annualMonthlyPrice,
  annualTotalPrice,
  HIGHLIGHTED_PLAN_ID,
  TRIAL_DAYS,
  type Plan,
} from '@/lib/billing/plans'
import { formatPrice, PLAN_COPY } from '@/lib/marketing/pricing'
export function PricingToggle({ plans }: { plans: Plan[] }) {
  const [annual, setAnnual] = useState(true)
  return (
    <>
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2>Hosted plans</h2>
          <p className="mt-2 text-sm text-slate-600">
            No per-seat fees. Model usage is billed separately.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
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
      <div className="grid gap-5 lg:grid-cols-3">
        {plans.map((plan) => {
          const highlighted = plan.id === HIGHLIGHTED_PLAN_ID
          const copy = PLAN_COPY[plan.id]
          return (
            <div
              key={plan.id}
              role="region"
              aria-label={`${plan.name} plan`}
              className={`relative flex flex-col rounded-xl border bg-white p-6 ${
                highlighted
                  ? 'border-blue-600 ring-1 ring-blue-600'
                  : 'border-slate-200'
              }`}
            >
              <div className="mb-4 min-h-6">
                {highlighted && (
                  <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                    Recommended
                  </span>
                )}
              </div>
              <h3>{plan.name}</h3>
              <p className="mt-2 min-h-16 text-sm text-slate-600">
                {copy.description}
              </p>
              <div className="mt-5">
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
              <p className="mt-5 border-t border-slate-200 pt-5 font-semibold">
                {plan.deflectionsPerMonth === null
                  ? 'Unlimited automated answers'
                  : `${plan.deflectionsPerMonth.toLocaleString(
                      'en-US',
                    )} automated answers/month`}
              </p>
              <p className="mt-1 min-h-12 text-sm text-slate-600">
                {plan.overageRatePer100Cents !== null
                  ? `Then ${formatPrice(
                      plan.overageRatePer100Cents,
                    )} per additional block of 100.`
                  : plan.deflectionsPerMonth === null
                  ? 'No automated-answer overage charges.'
                  : 'Automatic replies pause at the limit.'}
              </p>
              <Link
                href={`/login?plan=${plan.id}&interval=${
                  annual ? 'annual' : 'monthly'
                }`}
                className={`marketing-button mt-5 ${
                  highlighted ? '' : 'marketing-button-secondary'
                }`}
              >
                Start {TRIAL_DAYS}-day free trial
              </Link>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                Card required, but you&apos;re not charged today. Cancel
                before the {TRIAL_DAYS}-day trial ends to avoid the charge.
              </p>
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
