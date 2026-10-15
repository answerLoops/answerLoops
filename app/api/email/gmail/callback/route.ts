import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { exchangeGmailCode } from '@/lib/email/gmail'
import { upsertEmailOauthConnection } from '@/lib/db/queries/email-oauth'
import { upsertIntegration } from '@/lib/db/queries/integrations'
import { clearOAuthNonceCookie, oauthNonceCookieName, verifyOAuthCallback } from '@/lib/oauth/state'
import { appOrigin } from '@/lib/site'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/email/gmail/callback'

export async function GET(req: NextRequest) {
  const access = await requireOrgAccess(['owner', 'admin'])

  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  // Keep the post-consent page on the product host. In the hosted deployment
  // the callback may be registered on the apex domain while the dashboard is
  // on the app subdomain; this keeps the user from landing on the marketing
  // host afterward.
  const baseUrl = appOrigin() ?? process.env.AUTH_URL ?? req.nextUrl.origin
  const settingsUrl = new URL('/integrations', baseUrl)
  settingsUrl.searchParams.set('tab', 'email')

  // The nonce cookie is single use: every outcome below clears it.
  const finish = (url: URL, errorCode?: string) => {
    if (errorCode) url.searchParams.set('gmail_error', errorCode)
    return clearOAuthNonceCookie(NextResponse.redirect(url), 'gmail')
  }

  if (!access.ok) {
    if (access.error === 'Unauthorized') return NextResponse.redirect(new URL('/login', baseUrl))
    return finish(settingsUrl, 'forbidden')
  }

  let orgId: number
  try {
    const decoded = verifyOAuthCallback({
      provider: 'gmail',
      state,
      cookieNonce: req.cookies.get(oauthNonceCookieName('gmail'))?.value,
      caller: { userId: access.userId, orgId: access.orgId },
    })
    orgId = decoded.orgId
  } catch {
    return finish(settingsUrl, 'invalid_state')
  }

  if (error || !code) {
    return finish(settingsUrl, error ?? 'cancelled')
  }

  try {
    const result = await exchangeGmailCode(code)
    if ('error' in result) {
      return finish(settingsUrl, 'token_exchange_failed')
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
    return finish(settingsUrl)
  } catch (err) {
    logger.error('gmail oauth callback failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return finish(settingsUrl, 'token_exchange_failed')
  }
}
