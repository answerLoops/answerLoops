import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { exchangeGmailCode } from '@/lib/email/gmail'
import { upsertEmailOauthConnection } from '@/lib/db/queries/email-oauth'
import { upsertIntegration } from '@/lib/db/queries/integrations'
import { clearGmailOauthStateCookie, GMAIL_OAUTH_STATE_COOKIE } from '../install/route'
import { appOrigin } from '@/lib/site'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/email/gmail/callback'

function redirectWithError(url: URL, error: string): NextResponse {
  url.searchParams.set('gmail_error', error)
  const response = NextResponse.redirect(url)
  return clearGmailOauthStateCookie(response)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.redirect(new URL('/login', req.url))

  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')
  const stateCookie = req.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value

  // Keep the post-consent page on the product host. In the hosted deployment
  // the callback may be registered on the apex domain while the dashboard is
  // on the app subdomain; the shared state cookie makes that callback safe,
  // and this keeps the user from landing on the marketing host afterward.
  const baseUrl = appOrigin() ?? process.env.AUTH_URL ?? req.nextUrl.origin
  const settingsUrl = new URL('/settings', baseUrl)
  settingsUrl.searchParams.set('tab', 'email')

  let orgId: number
  try {
    // Google can return from the unverified-app interstitial without echoing
    // the state query parameter. The short-lived, host-only cookie preserves
    // the same state for that case while still rejecting a mismatched value.
    if (!stateCookie || (state && state !== stateCookie)) throw new Error('state mismatch')
    const decoded = JSON.parse(Buffer.from(stateCookie, 'base64url').toString()) as { orgId: number; ts: number }
    if (Date.now() - decoded.ts > 10 * 60 * 1000) throw new Error('expired')
    orgId = decoded.orgId
  } catch {
    return redirectWithError(settingsUrl, 'invalid_state')
  }

  if (error || !code) {
    return redirectWithError(settingsUrl, error ?? 'cancelled')
  }

  try {
    const result = await exchangeGmailCode(code)
    if ('error' in result) {
      return redirectWithError(settingsUrl, 'token_exchange_failed')
    }

    await upsertEmailOauthConnection({
      orgId,
      provider: 'gmail',
      mailboxAddress: result.mailboxAddress,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessTokenExpiresAt: result.expiresAt,
      grantedScope: result.scope,
    })
    await upsertIntegration({ orgId, platform: 'email', emailSendMethod: 'oauth' })

    settingsUrl.searchParams.set('gmail_connected', '1')
    const response = NextResponse.redirect(settingsUrl)
    return clearGmailOauthStateCookie(response)
  } catch (err) {
    logger.error('gmail oauth callback failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return redirectWithError(settingsUrl, 'token_exchange_failed')
  }
}
