import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth/state'
import { buildGmailAuthUrl } from '@/lib/email/gmail'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/email/gmail/install'

export async function GET(req: NextRequest) {
  const settingsUrl = (error: string) => {
    const url = new URL('/integrations', process.env.AUTH_URL ?? req.nextUrl.origin)
    url.searchParams.set('tab', 'email')
    url.searchParams.set('gmail_error', error)
    return url
  }

  try {
    const access = await requireOrgAccess(['owner', 'admin'])
    if (!access.ok) {
      if (access.error === 'Unauthorized') return Response.redirect(new URL('/login', req.url))
      return Response.redirect(settingsUrl('forbidden'))
    }

    const { state, nonce } = createOAuthState({ provider: 'gmail', orgId: access.orgId, userId: access.userId })

    const authUrl = buildGmailAuthUrl(state)
    if (typeof authUrl !== 'string') {
      return Response.redirect(settingsUrl('server_misconfigured'))
    }

    return setOAuthNonceCookie(NextResponse.redirect(authUrl), 'gmail', nonce)
  } catch (err) {
    logger.error('gmail oauth install failed', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.redirect(settingsUrl('server_misconfigured'))
  }
}
