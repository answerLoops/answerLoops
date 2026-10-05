import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getIntegration, markTelegramWebhookRegistered } from '@/lib/db/queries/integrations'
import { registerTelegramWebhook } from '@/lib/telegram/webhook'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/telegram/register'

export async function POST(req: NextRequest) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })

  const orgId = access.orgId

  try {
    const integration = await getIntegration(orgId, 'telegram')

    if (!integration?.bot_token) {
      return Response.json({ error: 'Save bot token first' }, { status: 400 })
    }
    if (!integration.bot_secret) {
      return Response.json({ error: 'Bot secret missing — re-save the integration' }, { status: 400 })
    }

    // TELEGRAM_WEBHOOK_BASE_URL lets a self-hosted dev setup point Telegram's
    // webhook at a tunnel (ngrok, etc.) independently of AUTH_URL, which also
    // drives the OAuth callback host — the two need different values whenever
    // the app itself is reached at a different origin than the public
    // tunnel, e.g. testing locally over HTTPS while signing in on localhost.
    const baseUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL ?? process.env.AUTH_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`
    const result = await registerTelegramWebhook(integration.bot_token, integration.bot_secret, baseUrl)

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 502 })
    }
    await markTelegramWebhookRegistered(orgId)
    return Response.json({ ok: true, webhookUrl: result.webhookUrl })
  } catch (err) {
    logger.error('telegram webhook registration failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
