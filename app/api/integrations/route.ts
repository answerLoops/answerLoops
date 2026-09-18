import { auth } from '@/auth'
import { listIntegrations, parseChannelIds } from '@/lib/db/queries/integrations'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/integrations'

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user) return new Response('Unauthorized', { status: 401 })

    const orgId = session.orgId ?? DEFAULT_ORG_ID
    const rows = await listIntegrations(orgId)

    // Strip bot_token from response — never expose it client-side
    const safe = rows.map(({ bot_token: _t, ...row }) => ({
      ...row,
      channel_ids: parseChannelIds(row as Parameters<typeof parseChannelIds>[0]),
    }))

    return Response.json(safe)
  } catch (err) {
    logger.error('failed to list integrations', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
