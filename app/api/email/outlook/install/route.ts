import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { signOAuthState } from '@/lib/oauth/state'
import { buildOutlookAuthUrl } from '@/lib/email/outlook'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/email/outlook/install'

export async function GET(req: NextRequest) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.redirect(new URL('/login', req.url))

    const state = signOAuthState({ orgId: access.orgId })

    const authUrl = buildOutlookAuthUrl(state)
    if (typeof authUrl !== 'string') {
      const settingsUrl = new URL('/settings', process.env.AUTH_URL ?? req.nextUrl.origin)
      settingsUrl.searchParams.set('tab', 'email')
      settingsUrl.searchParams.set('outlook_error', 'server_misconfigured')
      return Response.redirect(settingsUrl)
    }

    return Response.redirect(authUrl)
  } catch (err) {
    logger.error('outlook oauth install failed', { module: MOD, requestId: getRequestId(req), error: err })
    const settingsUrl = new URL('/settings', process.env.AUTH_URL ?? req.nextUrl.origin)
    settingsUrl.searchParams.set('tab', 'email')
    settingsUrl.searchParams.set('outlook_error', 'server_misconfigured')
    return Response.redirect(settingsUrl)
  }
}
