import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { signOAuthState } from '@/lib/oauth/state'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/slack/install'

// channels:join lets the bot add itself to a public channel once selected in
// the picker — without it, Slack never adds the bot to any channel on its
// own and conversations.history silently fails with not_in_channel forever.
// users:read resolves a message's raw user id to a display name via
// users.info (lib/slack/user-info.ts) — without it every Slack ticket's
// "From" field shows an opaque id like U0BMB9H6SFQ instead of a name. Not
// retroactive: an org that connected before this scope was added keeps its
// old-scoped token until it disconnects and reconnects.
const SCOPES = 'channels:history,channels:read,channels:join,chat:write,reactions:write,users:read'

export async function GET(req: NextRequest) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
    const { orgId } = access

    if (!(await orgHasFeature(orgId, 'slack_integration'))) {
      return Response.json({ error: 'Slack integration requires the Standard plan or above' }, { status: 403 })
    }

    const clientId = process.env.SLACK_CLIENT_ID
    if (!clientId) return Response.json({ error: 'SLACK_CLIENT_ID not configured' }, { status: 503 })

    const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin
    const redirectUri = `${baseUrl}/api/slack/callback`
    const from = req.nextUrl.searchParams.get('from') === 'onboarding' ? 'onboarding' : 'settings'
    const state = signOAuthState({ orgId, from })

    const url = new URL('https://slack.com/oauth/v2/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('scope', SCOPES)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)

    return Response.json({ url: url.toString() })
  } catch (err) {
    logger.error('slack install failed', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
