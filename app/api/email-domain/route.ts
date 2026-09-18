import { auth } from '@/auth'
import { getEmailDomain } from '@/lib/db/queries/email-domains'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MOD = 'api/email-domain'

export async function GET() {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const orgId = session.orgId ?? DEFAULT_ORG_ID

  try {
    const row = await getEmailDomain(orgId)
    if (!row) return Response.json(null)

    // Strip the internal Resend id from the client-facing response — not a
    // secret, but not needed by the UI either.
    const { provider_domain_id: _id, ...safe } = row
    return Response.json(safe)
  } catch (err) {
    logger.error('failed to load email domain', { module: MOD, orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
