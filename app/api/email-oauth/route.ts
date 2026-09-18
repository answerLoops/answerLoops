import { auth } from '@/auth'
import { getEmailOauthConnection } from '@/lib/db/queries/email-oauth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MOD = 'api/email-oauth'

export async function GET() {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const orgId = session.orgId ?? DEFAULT_ORG_ID

  try {
    const row = await getEmailOauthConnection(orgId)
    if (!row) return Response.json(null)

    // Never expose access_token/refresh_token to the client.
    const { access_token: _at, refresh_token: _rt, ...safe } = row
    return Response.json(safe)
  } catch (err) {
    logger.error('failed to load email oauth connection', { module: MOD, orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
