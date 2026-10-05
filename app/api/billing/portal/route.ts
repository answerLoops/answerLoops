import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireOrgAccess } from '@/lib/auth/org'
import { getStripe } from '@/lib/billing/stripe'
import { getSubscription } from '@/lib/db/queries/billing'
import { logger } from '@/lib/logger'

const MOD = 'api/billing/portal'

export async function POST() {
  const access = await requireOrgAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 401 })

  const orgId = access.orgId
  const sub = await getSubscription(orgId)

  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 404 })
  }

  // See the matching comment in app/api/billing/checkout/route.ts — a
  // Stripe-side failure here must never crash to an empty 500, since the
  // client always tries to parse the response as JSON.
  try {
    const stripe = getStripe()
    const baseUrl = process.env.AUTH_URL ?? 'http://localhost:3000'

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${baseUrl}/billing`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (err) {
    logger.error('Stripe billing portal session creation failed', { module: MOD, orgId, error: err })
    const message = err instanceof Stripe.errors.StripeError
      ? 'Could not open billing portal — billing is misconfigured. Contact support.'
      : 'Could not open billing portal. Try again.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
