import { requireOrgAccess } from '@/lib/auth/org'
import { listIntegrations, parseChannelIds } from '@/lib/db/queries/integrations'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/integrations'

export async function GET(request: Request) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return new Response(access.error, { status: 401 })

    const orgId = access.orgId
    const rows = await listIntegrations(orgId)

    const isAdmin = access.role === 'owner' || access.role === 'admin'

    // Explicit allow-list: stored credentials are never serialised. The only
    // secret-derived values are the token's last 4 characters, and the pending
    // Google Chat connect code / Circle setup value, which owner/admins must
    // see to finish setup. Both keep the `bot_secret` key the cards read.
    const safe = rows.map((row) => {
      const showSetupValue =
        isAdmin &&
        !!row.bot_secret &&
        ((row.platform === 'google_chat' && row.enabled !== 1 && row.bot_secret.startsWith('gc_')) ||
          row.platform === 'circle')
      return {
        id: row.id,
        org_id: row.org_id,
        platform: row.platform,
        bot_username: row.bot_username,
        connected_guild_id: row.connected_guild_id,
        team_id: row.team_id,
        webhook_registered_at: row.webhook_registered_at,
        escalation_role_id: row.escalation_role_id,
        confidence_threshold: row.confidence_threshold,
        enabled: row.enabled,
        auto_deflect_enabled: row.auto_deflect_enabled,
        email_send_method: row.email_send_method,
        created_at: row.created_at,
        updated_at: row.updated_at,
        has_bot_token: !!row.bot_token,
        has_bot_secret: !!row.bot_secret,
        has_webhook_secret: !!row.webhook_secret,
        bot_token_last4: row.bot_token ? row.bot_token.slice(-4) : null,
        bot_secret: showSetupValue ? row.bot_secret : null,
        channel_ids: parseChannelIds(row as Parameters<typeof parseChannelIds>[0]),
      }
    })

    return Response.json(safe)
  } catch (err) {
    logger.error('failed to list integrations', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
