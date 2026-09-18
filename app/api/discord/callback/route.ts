import { type NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { requireOrgAccess } from '@/lib/auth/org'
import { verifyOAuthState } from '@/lib/oauth/state'
import { getIntegration, upsertIntegration } from '@/lib/db/queries/integrations'
import { addDiscordGuild, DiscordGuildTakenError } from '@/lib/db/queries/discord-guilds'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/discord/callback'

export async function GET(req: NextRequest) {
  const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin

  const access = await requireOrgAccess()
  if (!access.ok) {
    return Response.redirect(new URL('/login', baseUrl))
  }

  const { searchParams } = req.nextUrl
  const guildId = searchParams.get('guild_id')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // The org id is taken only from a state this server signed, and only when
  // the current caller still belongs to that org. Anything else is rejected;
  // there is no default-org fallback.
  let orgId: number
  let from = 'settings'
  try {
    const decoded = verifyOAuthState(state)
    if (decoded.orgId !== access.orgId) throw new Error('org mismatch')
    orgId = decoded.orgId
    from = decoded.from === 'onboarding' ? 'onboarding' : 'settings'
  } catch {
    const bad = new URL('/settings', baseUrl)
    bad.searchParams.set('tab', 'discord')
    bad.searchParams.set('discord_error', 'invalid_state')
    return Response.redirect(bad)
  }

  const failUrl = new URL(from === 'onboarding' ? '/onboarding' : '/settings', baseUrl)
  if (from !== 'onboarding') failUrl.searchParams.set('tab', 'discord')

  if (error || !guildId) {
    failUrl.searchParams.set('discord_error', error ?? 'cancelled')
    return Response.redirect(failUrl)
  }

  try {
    if (!(await orgHasFeature(orgId, 'discord_integration'))) {
      failUrl.searchParams.set('discord_error', 'plan_required')
      return Response.redirect(failUrl)
    }

    // Org-level row still carries the shared bot_secret used for every guild
    // this org connects — ensure it exists, but no longer stores a single
    // connected_guild_id (that's now one row per guild in discord_guilds).
    const existing = await getIntegration(orgId, 'discord')
    const botSecret = existing?.bot_secret ?? crypto.randomBytes(32).toString('hex')
    if (!existing?.bot_secret) {
      await upsertIntegration({ orgId, platform: 'discord', botSecret })
    }

    try {
      await addDiscordGuild(orgId, guildId)
    } catch (err) {
      if (err instanceof DiscordGuildTakenError) {
        failUrl.searchParams.set('discord_error', 'guild_already_connected')
        return Response.redirect(failUrl)
      }
      throw err
    }
  } catch (err) {
    logger.error('discord oauth callback failed', { module: MOD, orgId, requestId: getRequestId(req), error: err })
    failUrl.searchParams.set('discord_error', 'server_error')
    return Response.redirect(failUrl)
  }

  if (from === 'onboarding') {
    const next = new URL('/onboarding', baseUrl)
    next.searchParams.set('discord_connected', '1')
    next.searchParams.set('guild_id', guildId)
    return Response.redirect(next)
  }

  const settingsUrl = new URL('/settings', baseUrl)
  settingsUrl.searchParams.set('tab', 'discord')
  settingsUrl.searchParams.set('discord_connected', '1')
  settingsUrl.searchParams.set('guild_id', guildId)
  return Response.redirect(settingsUrl)
}
