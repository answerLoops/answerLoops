import type { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { getIntegration } from '@/lib/db/queries/integrations'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/slack/channels'

interface SlackChannel {
  id: string
  name: string
  is_member: boolean
  num_members: number
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = (session as { orgId?: number }).orgId ?? DEFAULT_ORG_ID

  const integration = await getIntegration(orgId, 'slack')
  if (!integration?.bot_token) {
    return Response.json({ error: 'Slack not connected' }, { status: 400 })
  }

  try {
    const res = await fetch(
      'https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200',
      { headers: { Authorization: `Bearer ${integration.bot_token}` }, signal: AbortSignal.timeout(10_000) }
    )
    const data = await res.json() as { ok: boolean; channels?: SlackChannel[]; error?: string }

    if (!data.ok) return Response.json({ error: data.error ?? 'slack_api_error' }, { status: 400 })

    const channels = (data.channels ?? [])
      .map((c) => ({ id: c.id, name: c.name, is_member: c.is_member, num_members: c.num_members }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return Response.json(channels)
  } catch (err) {
    logger.error('slack channels fetch failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
