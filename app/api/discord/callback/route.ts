import { type NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { requireOrgAccess } from '@/lib/auth/org'
import { clearOAuthNonceCookie, oauthNonceCookieName, verifyOAuthCallback } from '@/lib/oauth/state'
import { verifyDiscordInstall } from '@/lib/discord/oauth'
import { getIntegration, upsertIntegration } from '@/lib/db/queries/integrations'
import { addDiscordGuild, DiscordGuildTakenError } from '@/lib/db/queries/discord-guilds'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/discord/callback'

export async function GET(req: NextRequest) {
  const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin

  const access = await requireOrgAccess(['owner', 'admin'])

  // The nonce cookie is single use: every outcome below clears it.
  const finish = (url: URL) => clearOAuthNonceCookie(NextResponse.redirect(url), 'discord')

  const errorUrl = (code: string) => {
    const url = new URL('/settings', baseUrl)
    url.searchParams.set('tab', 'discord')
    url.searchParams.set('discord_error', code)
    return url
  }

  if (!access.ok) {
    if (access.error === 'Unauthorized') return NextResponse.redirect(new URL('/login', baseUrl))
    return finish(errorUrl('forbidden'))
  }

  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // The org id is taken only from a state this server signed for this user,
  // matched to the nonce cookie set when the flow began. Anything else is
  // rejected; there is no default-org fallback.
  let orgId: number
  let from = 'settings'
  try {
    const decoded = verifyOAuthCallback({
      provider: 'discord',
      state,
      cookieNonce: req.cookies.get(oauthNonceCookieName('discord'))?.value,
      caller: { userId: access.userId, orgId: access.orgId },
    })
    orgId = decoded.orgId
    from = decoded.from === 'onboarding' ? 'onboarding' : 'settings'
  } catch {
    return finish(errorUrl('invalid_state'))
  }

  const failUrl = new URL(from === 'onboarding' ? '/onboarding' : '/settings', baseUrl)
  if (from !== 'onboarding') failUrl.searchParams.set('tab', 'discord')

  if (error || !code) {
    failUrl.searchParams.set('discord_error', error ?? 'cancelled')
    return finish(failUrl)
  }

  let guildId: string
  try {
    if (!(await orgHasFeature(orgId, 'discord_integration'))) {
      failUrl.searchParams.set('discord_error', 'plan_required')
      return finish(failUrl)
    }

    // The server comes from the token response for this code, and the
    // authorizing user must manage it and the bot must be in it.
    const verified = await verifyDiscordInstall({ code, redirectUri: `${baseUrl}/api/discord/callback` })
    if (!verified.ok) {
      failUrl.searchParams.set('discord_error', verified.error)
      return finish(failUrl)
    }
    guildId = verified.guildId

    // Org-level row still carries the shared bot_secret used for every guild
    // this org connects — ensure it exists, but no longer stores a single
    // connected_guild_id (that's now one row per guild in discord_guilds).
    const existing = await getIntegration(orgId, 'discord')
    const botSecret = existing?.bot_secret ?? crypto.randomBytes(32).toString('hex')
    if (!existing?.bot_secret) {
      await upsertIntegration({ orgId, platform: 'discord', botSecret })
    }

    try {
      await addDiscordGuild(orgId, guildId, verified.guildName)
    } catch (err) {
      if (err instanceof DiscordGuildTakenError) {
        failUrl.searchParams.set('discord_error', 'guild_already_connected')
        return finish(failUrl)
      }
      throw err
    }
  } catch (err) {
    logger.error('discord oauth callback failed', { module: MOD, orgId, requestId: getRequestId(req), error: err })
    failUrl.searchParams.set('discord_error', 'server_error')
    return finish(failUrl)
  }

  const successUrl = new URL(from === 'onboarding' ? '/onboarding' : '/settings', baseUrl)
  if (from !== 'onboarding') successUrl.searchParams.set('tab', 'discord')
  successUrl.searchParams.set('discord_connected', '1')
  successUrl.searchParams.set('guild_id', guildId)
  return finish(successUrl)
}
