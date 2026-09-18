import { type NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { signOAuthState } from '@/lib/oauth/state'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

// Permissions: View Channel + Send Messages + Read Message History + Add Reactions + Embed Links
const PERMISSIONS = '85056'

const MOD = 'api/discord/invite-url'

export async function GET(req: NextRequest) {
  const clientId = process.env.DISCORD_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'DISCORD_CLIENT_ID not configured' }, { status: 503 })
  }

  try {
    const access = await requireOrgAccess()
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 401 })
    }
    const { orgId } = access

    if (!(await orgHasFeature(orgId, 'discord_integration'))) {
      return NextResponse.json({ error: 'Discord integration requires the Standard plan or above' }, { status: 403 })
    }

    const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin
    const redirectUri = `${baseUrl}/api/discord/callback`

    // Where the flow started, so the callback returns the user to the right
    // screen. Only 'onboarding' is meaningful; anything else means Settings.
    const from = req.nextUrl.searchParams.get('from') === 'onboarding' ? 'onboarding' : 'settings'
    const state = signOAuthState({ orgId, from })

    const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${PERMISSIONS}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`

    return NextResponse.json({ url })
  } catch (err) {
    logger.error('failed to build discord invite url', { module: MOD, requestId: getRequestId(req), error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
