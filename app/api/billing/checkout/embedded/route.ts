import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { stripeConfigured, parseBillingInterval } from '@/lib/billing/plans'
import { createEmbeddedCheckoutSession } from '@/lib/billing/checkout'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/billing/checkout/embedded'

/**
 * Client secret for the embedded checkout form on /checkout.
 *
 * Separate from the hosted-session route next door rather than a mode flag on
 * it: the two return different things (a client secret versus a redirect URL),
 * and a caller that confused them would fail at the point of payment. The
 * hosted route still backs in-dashboard plan upgrades.
 *
 * The plan is re-selected here on every call because the checkout page lets
 * someone switch plan or interval without leaving it — each switch needs a
 * fresh session, since a Checkout Session's line items are fixed once created.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Billing is not available on this deployment' }, { status: 400 })
  }

  const orgId = session.orgId ?? DEFAULT_ORG_ID

  try {
    const { planId, interval } = (await req.json()) as { planId?: string; interval?: string }

    if (!planId) return NextResponse.json({ error: 'Missing plan' }, { status: 400 })

    // Narrowed here as well as on the page: this arrives from the client, and it
    // decides which Stripe price the customer is charged against. An
    // unrecognised value falls back to monthly rather than being trusted.
    const parsed = parseBillingInterval(interval) ?? 'monthly'

    const result = await createEmbeddedCheckoutSession(
      orgId,
      planId,
      session.user.email ?? '',
      session.user.name ?? '',
      parsed,
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ clientSecret: result.clientSecret })
  } catch (err) {
    logger.error('failed to create embedded checkout session', { module: MOD, orgId, requestId: getRequestId(req), error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
