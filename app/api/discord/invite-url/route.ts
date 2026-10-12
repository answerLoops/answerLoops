import { type NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth/state'
import { buildDiscordInviteUrl } from '@/lib/discord/oauth'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/discord/invite-url'

export async function GET(req: NextRequest) {
  const clientId = process.env.DISCORD_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'DISCORD_CLIENT_ID not configured' }, { status: 503 })
  }
  // The callback exchanges the code with the client secret and confirms the bot
  // joined using the platform bot token, so the 1-click flow needs both.
  if (!process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_TOKEN) {
    return NextResponse.json({ error: 'DISCORD_CLIENT_SECRET and DISCORD_TOKEN must be configured' }, { status: 503 })
  }

  try {
    const access = await requireOrgAccess(['owner', 'admin'])
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })
    }
    const { orgId, userId } = access

    if (!(await orgHasFeature(orgId, 'discord_integration'))) {
      return NextResponse.json({ error: 'Discord integration requires the Standard plan or above' }, { status: 403 })
    }

    const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin
    const redirectUri = `${baseUrl}/api/discord/callback`

    // Where the flow started, so the callback returns the user to the right
    // screen. Only 'onboarding' is meaningful; anything else means Settings.
    const from = req.nextUrl.searchParams.get('from') === 'onboarding' ? 'onboarding' : 'settings'
    const { state, nonce } = createOAuthState({ provider: 'discord', orgId, userId, from })

    const url = buildDiscordInviteUrl({ clientId, redirectUri, state })

    return setOAuthNonceCookie(NextResponse.json({ url }), 'discord', nonce)
  } catch (err) {
    logger.error('failed to build discord invite url', { module: MOD, requestId: getRequestId(req), error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
