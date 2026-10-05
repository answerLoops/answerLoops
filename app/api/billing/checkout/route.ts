import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireOrgAccess } from '@/lib/auth/org'
import { stripeConfigured } from '@/lib/billing/plans'
import { createCheckoutSession } from '@/lib/billing/checkout'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/billing/checkout'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await requireOrgAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 401 })

  // Self-hosted deployments aren't metered and have no billing to check out
  // into — the UI already hides this path, this is the API-level backstop.
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Billing is not available on this deployment' }, { status: 400 })
  }

  const orgId = access.orgId

  try {
    const { planId } = (await req.json()) as { planId: string }

    const result = await createCheckoutSession(
      orgId,
      planId,
      session.user.email ?? '',
      session.user.name ?? '',
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ url: result.url })
  } catch (err) {
    logger.error('failed to create checkout session', { module: MOD, orgId, requestId: getRequestId(req), error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
