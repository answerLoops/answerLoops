'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'
import {
  ANNUAL_DISCOUNT_PCT,
  annualMonthlyPrice,
  annualTotalPrice,
  TRIAL_DAYS,
  type BillingInterval,
  type Plan,
} from '@/lib/billing/plans'

/**
 * The checkout page's interactive half.
 *
 * Stripe's form renders in an iframe here rather than on checkout.stripe.com,
 * which is what lets the plan picker, the feature list and the FAQ sit around
 * it in our own layout. Stripe still owns everything inside that frame — card
 * fields, 3D Secure, wallet buttons, the promotion-code input — so switching to
 * this did not mean re-implementing any of it.
 *
 * A Checkout Session's line items are fixed once created, so changing plan or
 * interval cannot mutate the current session: each switch fetches a new client
 * secret, and the `key` on the provider forces a genuine remount rather than a
 * re-render against a stale one.
 */

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`

const GATEWAY_STATUSES = new Set([502, 503, 504])
const GATEWAY_RETRY_DELAY_MS = 1500

type SecretOutcome =
  | { kind: 'secret'; clientSecret: string }
  | { kind: 'error'; message: string }
  // The edge or host answered instead of the app — a restart or deploy in
  // progress. Worth one retry; says nothing about the customer's connection.
  | { kind: 'gateway' }

async function requestClientSecret(planId: string, interval: BillingInterval): Promise<SecretOutcome> {
  const res = await fetch('/api/billing/checkout/embedded', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, interval }),
  })
  // An error page from Cloudflare or the host is HTML. Parsing it as JSON
  // used to throw into the "check your connection" branch, which blamed the
  // customer for a server-side outage.
  const data = (await res.json().catch(() => null)) as { clientSecret?: string; error?: string } | null
  if (data?.error) return { kind: 'error', message: data.error }
  if (data?.clientSecret) return { kind: 'secret', clientSecret: data.clientSecret }
  if (GATEWAY_STATUSES.has(res.status)) return { kind: 'gateway' }
  return {
    kind: 'error',
    message: 'Checkout returned an unexpected response. Try selecting the plan again.',
  }
}

interface Props {
  plans: Plan[]
  initialPlanId: string
  initialInterval: BillingInterval
  /**
   * Passed in from the server rather than read here as
   * process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
   *
   * NEXT_PUBLIC_* is substituted at build time, which makes it the wrong
   * mechanism for this value twice over. A hosted deployment that sets the
   * variable after its last build keeps serving a bundle with `undefined`
   * baked in, and setting it again changes nothing until something forces a
   * rebuild. Worse, the published container image is built by CI, which has no
   * Stripe account at all — so every self-hoster running that image would
   * receive `undefined` permanently, with no way to override it.
   *
   * A server component reads the environment per request, so the same variable
   * name works in both cases with nothing rebuilt.
   *
   * The key is safe to send to the browser by design: it can only create
   * payment attempts, never read or move money.
   */
  publishableKey: string | null
}

export function EmbeddedCheckoutPanel({
  plans,
  initialPlanId,
  initialInterval,
  publishableKey,
}: Props) {
  const [planId, setPlanId] = useState(initialPlanId)
  const [interval, setInterval] = useState<BillingInterval>(initialInterval)
  // The last checkout response, tagged with the selection it was made for. Only
  // a response that matches the current selection is shown, so switching plan
  // or interval hides the previous session straight away (no effect has to
  // clear it) and a late response for a deselected plan can never be mounted.
  const [session, setSession] = useState<{
    planId: string
    interval: BillingInterval
    clientSecret: string | null
    error: string | null
  } | null>(null)
  const current = session && session.planId === planId && session.interval === interval ? session : null
  const clientSecret = current?.clientSecret ?? null
  const error = current?.error ?? null

  // The prefix is checked, not just presence. Stripe.js rejects a secret
  // (`sk_`) or restricted (`rk_`) key by throwing inside a promise it owns — so
  // nothing here catches it, no error state renders, and the page shows an
  // empty box where the card form should be. A blank payment step that reports
  // nothing is indistinguishable from a slow network. Three characters turn it
  // into a message.
  const stripePromise = useMemo(
    () => (publishableKey?.startsWith('pk_') ? loadStripe(publishableKey) : null),
    [publishableKey],
  )

  const plan = useMemo(() => plans.find((p) => p.id === planId) ?? plans[0], [plans, planId])
  const annual = interval === 'annual'

  useEffect(() => {
    // Abandoned when the selection changes again mid-flight: without this, two
    // rapid switches can resolve out of order and mount the session for the
    // plan that was deselected — which is the one thing on this page that must
    // never be wrong, since it decides what the card is charged for.
    let cancelled = false

    const settle = (secret: string | null, message: string | null) => {
      if (!cancelled) setSession({ planId, interval, clientSecret: secret, error: message })
    }

    void (async () => {
      try {
        let outcome = await requestClientSecret(planId, interval)
        if (outcome.kind === 'gateway') {
          await new Promise((resolve) => setTimeout(resolve, GATEWAY_RETRY_DELAY_MS))
          if (cancelled) return
          outcome = await requestClientSecret(planId, interval)
        }
        if (outcome.kind === 'secret') settle(outcome.clientSecret, null)
        else if (outcome.kind === 'error') settle(null, outcome.message)
        else settle(null, 'Checkout is temporarily unavailable. Please try again in a minute.')
      } catch {
        settle(null, 'Could not reach checkout. Check your connection and try again.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [planId, interval])

  const fetchClientSecret = useCallback(async () => clientSecret ?? '', [clientSecret])

  if (!stripePromise) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="font-medium">Checkout is unavailable.</p>
        <p className="mt-1 text-amber-800">
          {publishableKey
            ? 'STRIPE_PUBLISHABLE_KEY is not a publishable key. Stripe.js only accepts a key beginning "pk_" — a secret ("sk_") or restricted ("rk_") key fails silently, leaving this box empty.'
            : 'This deployment has no STRIPE_PUBLISHABLE_KEY configured.'}
        </p>
      </div>
    )
  }

  // Ordering is the whole point of this grid. On mobile the sequence is choose
  // a plan, then pay, then read the reassurance — payment sits second because
  // someone who already knows what they want should not scroll past the feature
  // list and four FAQ entries to reach the card form. On desktop payment moves
  // to its own column beside the other two.
  return (
    <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-x-14 lg:gap-y-10">
      {/* Payment — Stripe's iframe, our surroundings */}
      <div className="order-2 lg:order-1 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Payment</h2>

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
            <p className="text-sm font-medium text-red-900">{error}</p>
            <p className="mt-1 text-xs text-red-700">
              Nothing has been charged. Try selecting the plan again, or contact us if it keeps failing.
            </p>
          </div>
        ) : clientSecret ? (
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <EmbeddedCheckoutProvider
              // Remount on every new secret. Stripe reads the secret once at
              // mount, so reusing the component across a plan switch would keep
              // showing the previous plan's session.
              key={clientSecret}
              stripe={stripePromise}
              options={{ fetchClientSecret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          <div
            className="mt-5 h-[28rem] animate-pulse rounded-2xl border border-slate-200 bg-slate-50"
            aria-label="Loading payment form"
          />
        )}

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Secure payments processed by Stripe. Your card details never touch our servers.
        </p>
      </div>

      {/* Plan selection */}
      <div className="order-1 lg:col-start-2 lg:row-start-1">
        {/* Wraps rather than overflowing: the heading and the toggle only just
            fit on one line at 375px, so anything that widens either — a longer
            label, a fallback font — would otherwise push the toggle off-screen. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
            Choose a plan
          </h2>
          <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setInterval('monthly')}
              aria-pressed={!annual}
              className={`rounded-full px-3.5 py-2.5 transition-colors sm:py-1.5 ${!annual ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setInterval('annual')}
              aria-pressed={annual}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2.5 transition-colors sm:py-1.5 ${annual ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Annual
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] text-emerald-700">
                −{ANNUAL_DISCOUNT_PCT}%
              </span>
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {plans.map((p) => {
            const selected = p.id === plan.id
            const price = annual ? annualMonthlyPrice(p) : p.priceMonthly
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlanId(p.id)}
                aria-pressed={selected}
                className={`rounded-2xl border p-5 text-left transition ${
                  selected
                    ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="text-sm font-semibold text-slate-950">{p.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tracking-tight text-slate-950">
                    {money(price)}
                  </span>
                  <span className="text-xs text-slate-500">/mo</span>
                </div>
                {annual && (
                  <div className="mt-1 text-[0.6875rem] text-slate-500">
                    billed annually · {money(annualTotalPrice(p))}/yr
                  </div>
                )}
                <div className="mt-3 text-xs text-slate-600">
                  {p.deflectionsPerMonth === null
                    ? 'Unlimited deflections'
                    : `${p.deflectionsPerMonth.toLocaleString()} deflections/mo`}
                </div>
              </button>
            )
          })}
        </div>

      </div>

      {/* Reassurance — last on mobile, under the picker on desktop */}
      <div className="order-3 lg:col-start-2 lg:row-start-2">
        <ul className="space-y-2.5 text-sm text-slate-700">
          {[
            `${TRIAL_DAYS}-day free trial — pay nothing today`,
            'Cancel any time from Settings, no email required',
            'Bring your own AI provider key — no usage markup',
            'MCP server and REST API included on every plan',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[0.5625rem] text-emerald-700">
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-8 space-y-2">
          {[
            {
              q: 'Am I going to be charged today?',
              a: `No. The first ${TRIAL_DAYS} days are free. Your card is authorised now and charged only when the trial ends, and cancelling before then costs nothing.`,
            },
            {
              q: 'Can I change plan later?',
              a: 'Yes, from Settings → Billing. Upgrades apply immediately; downgrades take effect at the end of the period you already paid for.',
            },
            {
              q: 'What counts as a deflection?',
              a: 'One question the AI answered automatically with enough confidence that no human stepped in. Questions routed to a person never count, even when the AI drafted the reply.',
            },
            {
              q: 'How do I cancel?',
              a: 'Settings → Billing → Cancel. It takes one click and you do not have to talk to anyone.',
            },
          ].map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-slate-200 bg-white px-4 py-3 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-slate-900">
                {item.q}
                <span className="text-lg font-light text-slate-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  )
}
