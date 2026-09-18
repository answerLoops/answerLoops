import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { verifyOAuthState } from '@/lib/oauth/state'
import { exchangeOutlookCode } from '@/lib/email/outlook'
import { upsertEmailOauthConnection } from '@/lib/db/queries/email-oauth'
import { upsertIntegration } from '@/lib/db/queries/integrations'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/email/outlook/callback'

export async function GET(req: NextRequest) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.redirect(new URL('/login', req.url))

  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin
  const settingsUrl = new URL('/settings', baseUrl)
  settingsUrl.searchParams.set('tab', 'email')

  let orgId: number
  try {
    const decoded = verifyOAuthState(state)
    if (decoded.orgId !== access.orgId) throw new Error('org mismatch')
    orgId = decoded.orgId
  } catch {
    settingsUrl.searchParams.set('outlook_error', 'invalid_state')
    return Response.redirect(settingsUrl)
  }

  if (error || !code) {
    settingsUrl.searchParams.set('outlook_error', error ?? 'cancelled')
    return Response.redirect(settingsUrl)
  }

  try {
    const result = await exchangeOutlookCode(code)
    if ('error' in result) {
      settingsUrl.searchParams.set('outlook_error', 'token_exchange_failed')
      return Response.redirect(settingsUrl)
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
    return Response.redirect(settingsUrl)
  } catch (err) {
    logger.error('outlook oauth callback failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    settingsUrl.searchParams.set('outlook_error', 'token_exchange_failed')
    return Response.redirect(settingsUrl)
  }
}
