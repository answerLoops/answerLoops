import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { requireOrgAccess } from '@/lib/auth/org'
import { stripeConfigured, parseBillingInterval } from '@/lib/billing/plans'
import { createEmbeddedCheckoutSession } from '@/lib/billing/checkout'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/billing/checkout/embedded'

const BodySchema = z.object({
  planId: z.string().min(1).max(64),
  interval: z.string().max(32).optional(),
  // Validated by the lookup itself; a malformed value reports as an invalid code.
  promoCode: z.string().max(128).optional(),
})

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
  // Everything sits inside the try, including the session and org lookups. Both
  // hit the database, and a failure there outside the try becomes a bare 500
  // with no body — which the checkout page cannot tell apart from a dropped
  // connection.
  let orgId: number | undefined
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const access = await requireOrgAccess(['owner', 'admin'])
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })

    if (!stripeConfigured()) {
      return NextResponse.json({ error: 'Billing is not available on this deployment' }, { status: 400 })
    }

    orgId = access.orgId

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const body = BodySchema.safeParse(raw)
    if (!body.success) return NextResponse.json({ error: 'Missing plan' }, { status: 400 })
    const { planId, interval, promoCode } = body.data

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
      promoCode,
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ clientSecret: result.clientSecret, promoStatus: result.promoStatus })
  } catch (err) {
    logger.error('failed to create embedded checkout session', { module: MOD, orgId, requestId: getRequestId(req), error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
