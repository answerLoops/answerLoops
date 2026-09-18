import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { buildGmailAuthUrl } from '@/lib/email/gmail'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/email/gmail/install'

export const GMAIL_OAUTH_STATE_COOKIE = 'answerloops-gmail-oauth-state'

function gmailOauthStateCookieOptions() {
  const domain = process.env.AUTH_COOKIE_DOMAIN
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60,
    path: '/',
    ...(domain ? { domain } : {}),
  }
}

export function clearGmailOauthStateCookie(response: NextResponse): NextResponse {
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, '', {
    ...gmailOauthStateCookieOptions(),
    maxAge: 0,
  })
  return response
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return Response.redirect(new URL('/login', req.url))

    const orgId = (session as { orgId?: number }).orgId ?? DEFAULT_ORG_ID
    const state = Buffer.from(JSON.stringify({ orgId, ts: Date.now() })).toString('base64url')

    const authUrl = buildGmailAuthUrl(state)
    if (typeof authUrl !== 'string') {
      const settingsUrl = new URL('/settings', process.env.AUTH_URL ?? req.nextUrl.origin)
      settingsUrl.searchParams.set('tab', 'email')
      settingsUrl.searchParams.set('gmail_error', 'server_misconfigured')
      return Response.redirect(settingsUrl)
    }

    const response = NextResponse.redirect(authUrl)
    response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, gmailOauthStateCookieOptions())
    return response
  } catch (err) {
    logger.error('gmail oauth install failed', { module: MOD, requestId: getRequestId(req), error: err })
    const settingsUrl = new URL('/settings', process.env.AUTH_URL ?? req.nextUrl.origin)
    settingsUrl.searchParams.set('tab', 'email')
    settingsUrl.searchParams.set('gmail_error', 'server_misconfigured')
    return Response.redirect(settingsUrl)
  }
}
