import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { clearOAuthNonceCookie, oauthNonceCookieName, verifyOAuthCallback } from '@/lib/oauth/state'
import { upsertIntegration, getIntegration } from '@/lib/db/queries/integrations'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/slack/callback'

export async function GET(req: NextRequest) {
  const access = await requireOrgAccess(['owner', 'admin'])
  const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin
  if (!access.ok) {
    if (access.error === 'Unauthorized') return NextResponse.redirect(new URL('/login', baseUrl))
    const forbidden = new URL('/integrations', baseUrl)
    forbidden.searchParams.set('tab', 'slack')
    forbidden.searchParams.set('slack_error', 'forbidden')
    return NextResponse.redirect(forbidden)
  }

  // The nonce cookie is single use: every outcome below clears it.
  const finish = (url: URL) => clearOAuthNonceCookie(NextResponse.redirect(url), 'slack')

  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  let orgId: number
  let from: string | undefined
  try {
    const decoded = verifyOAuthCallback({
      provider: 'slack',
      state,
      cookieNonce: req.cookies.get(oauthNonceCookieName('slack'))?.value,
      caller: { userId: access.userId, orgId: access.orgId },
    })
    orgId = decoded.orgId
    from = decoded.from
  } catch {
    const settingsUrl = new URL('/integrations', baseUrl)
    settingsUrl.searchParams.set('tab', 'slack')
    settingsUrl.searchParams.set('slack_error', 'invalid_state')
    return finish(settingsUrl)
  }

  const settingsUrl = new URL(from === 'onboarding' ? '/onboarding' : '/integrations', baseUrl)
  if (from !== 'onboarding') settingsUrl.searchParams.set('tab', 'slack')

  if (error || !code) {
    settingsUrl.searchParams.set('slack_error', error ?? 'cancelled')
    return finish(settingsUrl)
  }

  try {
    if (!(await orgHasFeature(orgId, 'slack_integration'))) {
      settingsUrl.searchParams.set('slack_error', 'plan_required')
      return finish(settingsUrl)
    }

    const clientId = process.env.SLACK_CLIENT_ID
    const clientSecret = process.env.SLACK_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      settingsUrl.searchParams.set('slack_error', 'server_misconfigured')
      return finish(settingsUrl)
    }

    const redirectUri = `${baseUrl}/api/slack/callback`

    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    const tokenData = await tokenRes.json() as {
      ok: boolean
      access_token?: string
      team?: { id: string; name: string }
      error?: string
    }

    if (!tokenData.ok || !tokenData.access_token || !tokenData.team) {
      settingsUrl.searchParams.set('slack_error', tokenData.error ?? 'token_exchange_failed')
      return finish(settingsUrl)
    }

    // Signing secret is platform-wide — set once in env, not per workspace
    const signingSecret = process.env.SLACK_SIGNING_SECRET ?? ''

    // bot_secret authenticates this org's own traffic to /api/ingest (the
    // Slack poller's HTTP forward, and any other in-process caller) — a
    // completely different secret from the platform-wide webhook signing
    // secret above. Never generated here before, which meant every OAuth-
    // connected Slack integration had bot_secret permanently null: harmless
    // while cloud always used the webhook path, but it silently made the
    // slack_force_polling override (the one case that needs it) impossible
    // to actually use for a real customer. Preserve an existing secret across
    // reconnects, same pattern every other platform's save action already uses.
    const existing = await getIntegration(orgId, 'slack')
    const botSecret = existing?.bot_secret ?? crypto.randomBytes(32).toString('hex')

    await upsertIntegration({
      orgId,
      platform: 'slack',
      botToken: tokenData.access_token,
      botSecret,
      webhookSecret: signingSecret,
      teamId: tokenData.team.id,
    })

    settingsUrl.searchParams.set('slack_connected', '1')
    settingsUrl.searchParams.set('slack_team', tokenData.team.name)
    return finish(settingsUrl)
  } catch (err) {
    logger.error('slack oauth callback failed', { module: MOD, orgId, requestId: getRequestId(req), error: err })
    settingsUrl.searchParams.set('slack_error', 'server_error')
    return finish(settingsUrl)
  }
}
