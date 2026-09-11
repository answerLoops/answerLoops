import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'
import type { EmailOauthConnection } from '@/lib/db/queries/email-oauth'
import { updateOauthAccessToken } from '@/lib/db/queries/email-oauth'

const MOD = 'email/outlook'
// offline_access is what yields a refresh_token (Microsoft's equivalent of
// Google's access_type:'offline'); Mail.Send is the only delegated
// permission requested — no inbox read access.
const OUTLOOK_SCOPE = 'openid email offline_access Mail.Send'
const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

function redirectUri(): string {
  const base = process.env.OUTLOOK_REDIRECT_URI
  if (base) return base
  const appBase = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  return `${appBase}/api/email/outlook/callback`
}

function credentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.OUTLOOK_CLIENT_ID
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET
  if (MOCK_EXTERNALS || !clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function buildOutlookAuthUrl(state: string): string | { error: string } {
  const creds = credentials()
  if (!creds) return { error: 'Outlook OAuth is not configured — OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET missing' }

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', creds.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', OUTLOOK_SCOPE)
  url.searchParams.set('state', state)
  return url.toString()
}

interface OutlookTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export interface ExchangedOutlookTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
  scope: string
  mailboxAddress: string
}

export async function exchangeOutlookCode(code: string): Promise<ExchangedOutlookTokens | { error: string }> {
  const creds = credentials()
  if (!creds) return { error: 'Outlook OAuth is not configured' }

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: OUTLOOK_SCOPE,
      }),
    })
    const tokenData = (await tokenRes.json()) as OutlookTokenResponse
    if (!tokenRes.ok || !tokenData.access_token || !tokenData.refresh_token) {
      logger.error('Outlook code exchange failed', { module: MOD, error: tokenData.error, description: tokenData.error_description })
      return { error: tokenData.error_description ?? 'Failed to complete Outlook authorization' }
    }

    const meRes = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const me = (await meRes.json()) as { mail?: string; userPrincipalName?: string }
    const mailboxAddress = me.mail ?? me.userPrincipalName ?? null
    if (!meRes.ok || !mailboxAddress) return { error: 'Could not determine the connected Outlook address' }

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString(),
      scope: tokenData.scope ?? OUTLOOK_SCOPE,
      mailboxAddress,
    }
  } catch (err) {
    logger.error('Outlook code exchange threw', { module: MOD, error: err })
    return { error: 'Failed to complete Outlook authorization' }
  }
}

// Returns a usable access token, refreshing if the cached one is expired or
// missing. Kept as a pure token operation — does NOT touch connection status
// in the DB on failure; the caller decides what a reauth_required means for
// the send path (see lib/email/reply.ts).
export async function getValidOutlookAccessToken(
  connection: EmailOauthConnection
): Promise<string | { error: 'reauth_required' }> {
  const creds = credentials()
  if (!creds) return { error: 'reauth_required' }

  const stillValid =
    connection.access_token &&
    connection.access_token_expires_at &&
    new Date(connection.access_token_expires_at).getTime() > Date.now() + 60_000

  if (stillValid) return connection.access_token as string

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.refresh_token,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: OUTLOOK_SCOPE,
      }),
    })
    const tokenData = (await tokenRes.json()) as OutlookTokenResponse
    if (!tokenRes.ok || !tokenData.access_token) {
      logger.warn('Outlook refresh token is no longer valid', { module: MOD, orgId: connection.org_id, error: tokenData.error })
      return { error: 'reauth_required' }
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString()
    await updateOauthAccessToken(connection.org_id, tokenData.access_token, expiresAt)

    return tokenData.access_token
  } catch (err) {
    logger.warn('Outlook token refresh threw', { module: MOD, orgId: connection.org_id, error: err })
    return { error: 'reauth_required' }
  }
}

// Microsoft has no direct token-revoke endpoint the way Google does — the
// real revoke is the user removing the app from their My Apps page.
// answerLoops's own "Disconnect" only needs to stop using the token, which
// deleting the connection row already achieves; this is a documented no-op
// kept as a function so the call site in disconnectOauthAction stays
// provider-symmetric with Gmail's revokeGmailToken.
export async function revokeOutlookToken(_refreshToken: string): Promise<void> {
  // No-op — see comment above.
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Reads back the real RFC Message-ID Graph assigned after sending. Microsoft's
// own docs note server-added headers may not be immediately queryable right
// after send, so this retries briefly rather than a single blind GET.
async function readBackInternetMessageId(accessToken: string, messageId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(500)
    try {
      const res = await fetch(`${GRAPH_BASE}/me/messages/${messageId}?$select=internetMessageId`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (res.ok) {
        const data = (await res.json()) as { internetMessageId?: string }
        if (data.internetMessageId) return data.internetMessageId
      }
    } catch (err) {
      logger.warn('Outlook internetMessageId read-back attempt failed', { module: MOD, attempt, error: err })
    }
  }
  return null
}

// Three-call flow (not the single-call sendMail convenience endpoint, which
// supports neither extended properties nor a reliable way to read back the
// real Message-ID): create a draft, best-effort set In-Reply-To via the
// String 0x1042 extended property, send it, then read back the real
// Message-ID Graph assigned. No References header — Graph has no equivalent
// extended-property mapping for it and doesn't honor custom headers on
// reply/forward either way (see lib/email/reply.ts's Outlook branch).
export async function sendOutlook(
  accessToken: string,
  params: { to: string; from: string; subject: string; text: string; inReplyTo?: string }
): Promise<{ success: true; rfcMessageId: string; providerMessageId: string } | { error: string }> {
  const authHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }

  try {
    const draftRes = await fetch(`${GRAPH_BASE}/me/messages`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        subject: params.subject,
        body: { contentType: 'Text', content: params.text },
        toRecipients: [{ emailAddress: { address: params.to } }],
      }),
    })
    if (!draftRes.ok) {
      const body = await draftRes.text()
      logger.error('Outlook draft creation failed', { module: MOD, status: draftRes.status, body })
      return { error: `Outlook API returned ${draftRes.status}` }
    }
    const draft = (await draftRes.json()) as { id: string }

    if (params.inReplyTo) {
      const propRes = await fetch(`${GRAPH_BASE}/me/messages/${draft.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          singleValueExtendedProperties: [{ id: 'String 0x1042', value: params.inReplyTo }],
        }),
      })
      if (!propRes.ok) {
        // Best-effort — a missing In-Reply-To header degrades threading in
        // the customer's mail client but must not block the send.
        logger.warn('Outlook In-Reply-To extended property failed to set', { module: MOD, status: propRes.status })
      }
    }

    const sendRes = await fetch(`${GRAPH_BASE}/me/messages/${draft.id}/send`, {
      method: 'POST',
      headers: authHeaders,
    })
    if (!sendRes.ok) {
      const body = await sendRes.text()
      logger.error('Outlook send failed', { module: MOD, status: sendRes.status, body })
      return { error: `Outlook API returned ${sendRes.status}` }
    }

    const rfcMessageId = await readBackInternetMessageId(accessToken, draft.id)
    if (!rfcMessageId) {
      logger.warn('Could not read back Outlook internetMessageId — inbound threading may not match this reply', {
        module: MOD,
        providerMessageId: draft.id,
      })
    }

    return {
      success: true,
      rfcMessageId: rfcMessageId ?? `<${draft.id}@outlook-pending>`,
      providerMessageId: draft.id,
    }
  } catch (err) {
    logger.error('Outlook send threw', { module: MOD, error: err })
    return { error: 'Outlook send failed' }
  }
}
