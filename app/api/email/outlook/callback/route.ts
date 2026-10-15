import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { clearOAuthNonceCookie, oauthNonceCookieName, verifyOAuthCallback } from '@/lib/oauth/state'
import { exchangeOutlookCode } from '@/lib/email/outlook'
import { upsertEmailOauthConnection } from '@/lib/db/queries/email-oauth'
import { upsertIntegration } from '@/lib/db/queries/integrations'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/email/outlook/callback'

export async function GET(req: NextRequest) {
  const access = await requireOrgAccess(['owner', 'admin'])
  const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin
  const settingsUrl = new URL('/integrations', baseUrl)
  settingsUrl.searchParams.set('tab', 'email')

  // The nonce cookie is single use: every outcome below clears it.
  const finish = (url: URL) => clearOAuthNonceCookie(NextResponse.redirect(url), 'outlook')

  if (!access.ok) {
    if (access.error === 'Unauthorized') return NextResponse.redirect(new URL('/login', baseUrl))
    settingsUrl.searchParams.set('outlook_error', 'forbidden')
    return NextResponse.redirect(settingsUrl)
  }

  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  let orgId: number
  try {
    const decoded = verifyOAuthCallback({
      provider: 'outlook',
      state,
      cookieNonce: req.cookies.get(oauthNonceCookieName('outlook'))?.value,
      caller: { userId: access.userId, orgId: access.orgId },
    })
    orgId = decoded.orgId
  } catch {
    settingsUrl.searchParams.set('outlook_error', 'invalid_state')
    return finish(settingsUrl)
  }

  if (error || !code) {
    settingsUrl.searchParams.set('outlook_error', error ?? 'cancelled')
    return finish(settingsUrl)
  }

  try {
    const result = await exchangeOutlookCode(code)
    if ('error' in result) {
      settingsUrl.searchParams.set('outlook_error', 'token_exchange_failed')
      return finish(settingsUrl)
    }

    await upsertEmailOauthConnection({
      orgId,
      provider: 'outlook',
      mailboxAddress: result.mailboxAddress,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessTokenExpiresAt: result.expiresAt,
      grantedScope: result.scope,
    })
    await upsertIntegration({ orgId, platform: 'email', emailSendMethod: 'oauth' })

    settingsUrl.searchParams.set('outlook_connected', '1')
    return finish(settingsUrl)
  } catch (err) {
    logger.error('outlook oauth callback failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    settingsUrl.searchParams.set('outlook_error', 'token_exchange_failed')
    return finish(settingsUrl)
  }
}
