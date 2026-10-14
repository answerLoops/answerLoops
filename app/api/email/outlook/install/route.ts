import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth/state'
import { buildOutlookAuthUrl } from '@/lib/email/outlook'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/email/outlook/install'

export async function GET(req: NextRequest) {
  try {
    const access = await requireOrgAccess(['owner', 'admin'])
    if (!access.ok) {
      if (access.error === 'Unauthorized') return Response.redirect(new URL('/login', req.url))
      const forbidden = new URL('/settings', process.env.AUTH_URL ?? req.nextUrl.origin)
      forbidden.searchParams.set('tab', 'email')
      forbidden.searchParams.set('outlook_error', 'forbidden')
      return Response.redirect(forbidden)
    }

    const { state, nonce } = createOAuthState({ provider: 'outlook', orgId: access.orgId, userId: access.userId })

    const authUrl = buildOutlookAuthUrl(state)
    if (typeof authUrl !== 'string') {
      const settingsUrl = new URL('/settings', process.env.AUTH_URL ?? req.nextUrl.origin)
      settingsUrl.searchParams.set('tab', 'email')
      settingsUrl.searchParams.set('outlook_error', 'server_misconfigured')
      return Response.redirect(settingsUrl)
    }

    return setOAuthNonceCookie(NextResponse.redirect(authUrl), 'outlook', nonce)
  } catch (err) {
    logger.error('outlook oauth install failed', { module: MOD, requestId: getRequestId(req), error: err })
    const settingsUrl = new URL('/settings', process.env.AUTH_URL ?? req.nextUrl.origin)
    settingsUrl.searchParams.set('tab', 'email')
    settingsUrl.searchParams.set('outlook_error', 'server_misconfigured')
    return Response.redirect(settingsUrl)
  }
}
