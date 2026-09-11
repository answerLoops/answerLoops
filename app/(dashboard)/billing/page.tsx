'use client'

import { useEffect, useState, useTransition } from 'react'
import { ORDERED_PLANS, type Plan, overageUnits } from '@/lib/billing/plans'
import { useUpgrade } from '@/components/billing/use-upgrade'

interface BillingData {
  planId: string
  status: string
  isTrialing: boolean
  trialEndsAt: string | null
  used: number
  limit: number | null
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
}

const PLAN_FEATURES: Record<string, string[]> = {
  standard: [
    '500 AI deflections/mo',
    'Knowledge base (URL import)',
    'Discord + Slack integration',
    'Widget with lead capture',
    'MCP server + REST Agent API access',
    'Multi-language AI responses',
    'White-label widget (remove branding)',
    'CSV export',
    'Email support',
  ],
  pro: [
    '3,000 AI deflections/mo, then $5 per 100',
    'Everything in Standard',
    'CSAT scoring',
    'Human escalation routing',
    'Simulation / dry-run mode',
    'Knowledge gap dashboard',
    'Priority support',
  ],
  enterprise: [
    'Unlimited AI deflections',
    'Everything in Pro',
    'Custom AI model config',
    'Unlimited data retention',
    'White-glove migration off Zendesk/Intercom/Confluence',
    'SLA + automatic breach alerting',
    '6x higher MCP/Agent API rate limits',
    'Custom invoicing',
  ],
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-brand-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function daysRemaining(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

function TrialBanner({ trialEndsAt }: { trialEndsAt: string }) {
  const days = daysRemaining(trialEndsAt)
  const urgent = days <= 3
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-3 ${urgent ? 'border-amber-300 bg-amber-50' : 'border-brand-200 bg-brand-50'}`}>
      <div className={`mt-0.5 h-2 w-2 rounded-full flex-shrink-0 ${urgent ? 'bg-amber-500' : 'bg-brand-500'}`} />
      <div>
        <p className={`text-sm font-semibold ${urgent ? 'text-amber-800' : 'text-brand-800'}`}>
          {days === 0 ? 'Your trial ends today' : `${days} day${days === 1 ? '' : 's'} left in your trial`}
        </p>
        <p className={`mt-0.5 text-xs ${urgent ? 'text-amber-700' : 'text-brand-700'}`}>
          Your card will be charged when the trial ends. Cancel anytime before then.
        </p>
      </div>
    </div>
  )
}

function TrialExpiredBanner({ onUpgrade, pending }: { onUpgrade: (planId: string) => void; pending: boolean }) {
  const standard = ORDERED_PLANS.find((p) => p.id === 'standard')!
  return (
    <div className="rounded-xl border-2 border-red-200 bg-red-50 p-6 text-center space-y-3">
      <p className="text-sm font-semibold text-red-800">Your trial has ended</p>
      <p className="text-xs text-red-700">Choose a plan below to resume AI deflections and full access.</p>
      <button
        onClick={() => onUpgrade('standard')}
        disabled={pending}
        className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60 transition-colors"
      >
        {pending ? 'Redirecting…' : `Start Standard — $${(standard.priceMonthly / 100).toFixed(0)}/mo`}
      </button>
    </div>
  )
}

const NEXT_TIER: Record<string, string | null> = {
  standard: 'pro',
  pro: 'enterprise',
  enterprise: null,
}

function LimitWarningBanner({ planId, onUpgrade, pending }: { planId: string; onUpgrade: (planId: string) => void; pending: boolean }) {
  const nextPlan = NEXT_TIER[planId] ?? null
  const nextPlanName = nextPlan ? ORDERED_PLANS.find((p) => p.id === nextPlan)?.name : null
  const plan = ORDERED_PLANS.find((p) => p.id === planId)
  const softCap = !!plan && plan.overageRatePer100Cents !== null

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-2 w-2 rounded-full flex-shrink-0 bg-amber-500" />
        <div>
          <p className="text-sm font-semibold text-amber-800">
            {softCap ? 'Approaching your included deflections' : 'Approaching your deflection limit'}
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            {softCap
              ? "You've used over 80% of this month's included deflections. Answers keep going out past the limit — usage beyond it is billed at $5 per 100."
              : "You've used over 80% of this month's deflections. Upgrade now to avoid interruption."}
          </p>
        </div>
      </div>
      {nextPlan && (
        <button
          onClick={() => onUpgrade(nextPlan)}
          disabled={pending}
          className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60 transition-colors whitespace-nowrap"
        >
          {pending ? 'Redirecting…' : `Upgrade to ${nextPlanName} →`}
        </button>
      )}
    </div>
  )
}

function UsageBar({ used, limit, planId, currentPeriodEnd, cancelAtPeriodEnd, status }: {
  used: number
  limit: number | null
  planId: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  status: string
}) {
  const pct = limit ? Math.min((used / limit) * 100, 100) : 0
  const over = limit !== null && used >= limit
  const plan = ORDERED_PLANS.find((p) => p.id === planId)
  // A soft cap keeps answering past the quota and meters the overage; going
  // over is a billing event, not a service interruption, so it reads amber
  // rather than red.
  const softCap = !!plan && plan.overageRatePer100Cents !== null
  const overUnits = plan ? overageUnits(used, plan) : 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Usage this month</h2>
        <div className="flex items-center gap-2">
          {cancelAtPeriodEnd && currentPeriodEnd && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              Cancels {new Date(currentPeriodEnd).toLocaleDateString()}
            </span>
          )}
          {status === 'past_due' && (
            <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
              Payment past due
            </span>
          )}
        </div>
      </div>

      {limit === null ? (
        <div className="flex items-end gap-1.5">
          <span className="text-3xl font-bold text-gray-900">{used.toLocaleString()}</span>
          <span className="text-sm text-gray-500 mb-1">deflections · unlimited plan</span>
        </div>
      ) : (
        <>
          <div className="flex items-end gap-1.5 mb-3">
            <span className={`text-3xl font-bold ${over ? (softCap ? 'text-amber-600' : 'text-red-600') : 'text-gray-900'}`}>{used.toLocaleString()}</span>
            <span className="text-sm text-gray-500 mb-1">/ {limit.toLocaleString()} deflections</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-2.5 rounded-full transition-all duration-500 ${over ? (softCap ? 'bg-amber-500' : 'bg-red-500') : pct > 80 ? 'bg-amber-500' : 'bg-brand-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-start justify-between gap-3 mt-2">
            <span className="shrink-0 text-xs text-gray-400">{Math.round(pct)}% used</span>
            {over
              ? softCap
                ? <span className="text-xs font-medium text-amber-700">{overUnits.toLocaleString()} over your plan · answers keep going out, overage billed at $5 per 100</span>
                : <span className="text-xs font-medium text-red-600">Limit reached — upgrade to resume</span>
              : <span className="text-xs text-gray-400">{(limit - used).toLocaleString()} remaining</span>
            }
          </div>
        </>
      )}
    </div>
  )
}

function PlanCard({
  plan,
  current,
  isTrialing,
  onUpgrade,
  pending,
}: {
  plan: Plan
  current: boolean
  isTrialing: boolean
  onUpgrade: (planId: string) => void
  pending: boolean
}) {
  const label = current && isTrialing ? 'Trialing' : current ? 'Current plan' : null
  const features = PLAN_FEATURES[plan.id] ?? []
  const highlighted = plan.id === 'pro'

  return (
    <div className={`relative rounded-xl border-2 p-5 flex flex-col transition-all ${
      current
        ? 'border-brand-500 bg-brand-50/40'
        : highlighted
        ? 'border-brand-300 bg-white shadow-sm'
        : 'border-gray-200 bg-white hover:border-gray-300'
    }`}>
      {highlighted && !current && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-brand-600 px-3 py-0.5 text-[0.625rem] font-bold text-white uppercase tracking-wider shadow">
            Most popular
          </span>
        </div>
      )}

      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900">{plan.name}</span>
            {label && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[0.625rem] font-semibold text-brand-700 uppercase tracking-wide">
                {label}
              </span>
            )}
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-gray-900">${(plan.priceMonthly / 100).toFixed(0)}</span>
            <span className="text-xs text-gray-500">/mo</span>
          </div>
        </div>
      </div>

      <ul className="space-y-2 flex-1 mb-5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckIcon />
            <span className="text-xs text-gray-600">{f}</span>
          </li>
        ))}
      </ul>

      {current ? (
        <div className="w-full rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-center text-xs font-medium text-brand-700">
          {isTrialing ? 'Active trial' : 'Your current plan'}
        </div>
      ) : (
        <button
          onClick={() => onUpgrade(plan.id)}
          disabled={pending}
          className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
            highlighted
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
          }`}
        >
          {pending ? 'Redirecting…' : `Upgrade to ${plan.name}`}
        </button>
      )}
    </div>
  )
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const { upgrade, pending: upgradePending, error: upgradeError } = useUpgrade()
  const [portalPending, startPortal] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/billing/status')
      .then((r) => r.json())
      .then((d) => { setData(d as BillingData); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (upgradeError) setError(upgradeError)
  }, [upgradeError])

  function openPortal() {
    startPortal(async () => {
      setError(null)
      const r = await fetch('/api/billing/portal', { method: 'POST' })
      const { url, error: err } = await r.json() as { url?: string; error?: string }
      if (err) { setError(err); return }
      if (url) window.location.href = url
    })
  }

  const isCanceled = data?.status === 'canceled'
  const isTrialing = data?.isTrialing ?? false
  // 'none' (no subscription row yet — never started a trial) and
  // 'misconfigured'/'self-hosted' are not real plans; only show usage
  // against a real, currently-held plan.
  const hasPlan = data ? ORDERED_PLANS.some((p) => p.id === data.planId) : false
  const usagePct = data?.limit ? (data.used / data.limit) * 100 : 0
  const approachingLimit = !isCanceled && hasPlan && data?.limit !== null && usagePct >= 80 && usagePct < 100

  return (
    <div className="dashboard-page max-w-6xl space-y-8">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-blue-600">
          <span className="h-px w-6 bg-blue-500" />
          Workspace plan
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Billing</h1>
        <p className="mt-1 text-sm text-slate-500">Understand usage at a glance and scale without interrupting support.</p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          Loading billing info…
        </div>
      )}

      {!loading && data && (
        <>
          {isTrialing && data.trialEndsAt && <TrialBanner trialEndsAt={data.trialEndsAt} />}
          {approachingLimit && <LimitWarningBanner planId={data.planId} onUpgrade={upgrade} pending={upgradePending} />}
          {isCanceled && <TrialExpiredBanner onUpgrade={upgrade} pending={upgradePending} />}

          {!isCanceled && hasPlan && (
            <UsageBar
              used={data.used}
              limit={data.limit}
              planId={data.planId}
              currentPeriodEnd={data.currentPeriodEnd}
              cancelAtPeriodEnd={data.cancelAtPeriodEnd}
              status={data.status}
            />
          )}

          {data.planId === 'misconfigured' ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5">
              <p className="text-sm font-medium text-red-900">Billing is misconfigured</p>
              <p className="text-xs text-red-700 mt-1">
                This workspace can&apos;t be billed right now — contact support so this can be fixed on our end.
                Your data and access are unaffected.
              </p>
            </div>
          ) : data.planId === 'self-hosted' ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm font-medium text-gray-900">Self-hosted — no usage limit</p>
              <p className="text-xs text-gray-500 mt-1">
                This deployment isn&apos;t connected to answerLoops billing, so there&apos;s no plan or deflection cap to manage —
                you&apos;re running your own instance against your own AI, database, and hosting costs.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">Plans</h2>
                  <span className="text-xs text-gray-400">All plans include a 14-day free trial</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3">
                  {ORDERED_PLANS.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      current={plan.id === data.planId && !isCanceled}
                      isTrialing={isTrialing}
                      onUpgrade={upgrade}
                      pending={upgradePending}
                    />
                  ))}
                </div>
              </div>

              {!isCanceled && (
                <div className="flex flex-col items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Subscription management</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {isTrialing ? 'Cancel trial, update payment method, or switch plans' : 'Update payment method, change plan, or cancel'}
                    </p>
                  </div>
                  <button
                    onClick={openPortal}
                    disabled={portalPending}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    {portalPending ? 'Redirecting…' : 'Manage subscription →'}
                  </button>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  )
}
