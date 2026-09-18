import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { getIntegration } from '@/lib/db/queries/integrations'
import { registerTelegramWebhook } from '@/lib/telegram/webhook'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/telegram/register'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = session.orgId ?? DEFAULT_ORG_ID

  try {
    const integration = await getIntegration(orgId, 'telegram')

    if (!integration?.bot_token) {
      return Response.json({ error: 'Save bot token first' }, { status: 400 })
    }
    if (!integration.bot_secret) {
      return Response.json({ error: 'Bot secret missing — re-save the integration' }, { status: 400 })
    }

    const baseUrl = process.env.AUTH_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`
    const result = await registerTelegramWebhook(integration.bot_token, integration.bot_secret, baseUrl)

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 502 })
    }
    return Response.json({ ok: true, webhookUrl: result.webhookUrl })
  } catch (err) {
    logger.error('telegram webhook registration failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
