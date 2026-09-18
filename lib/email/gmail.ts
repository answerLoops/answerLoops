import { OAuth2Client } from 'google-auth-library'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'
import type { EmailOauthConnection } from '@/lib/db/queries/email-oauth'
import { updateOauthAccessToken } from '@/lib/db/queries/email-oauth'

const MOD = 'email/gmail'
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send openid email'

function redirectUri(): string {
  const base = process.env.GMAIL_REDIRECT_URI
  if (base) return base
  const appBase = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  return `${appBase}/api/email/gmail/callback`
}

function client(): OAuth2Client | null {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  if (MOCK_EXTERNALS || !clientId || !clientSecret) return null
  return new OAuth2Client({ clientId, clientSecret, redirectUri: redirectUri() })
}

export function buildGmailAuthUrl(state: string): string | { error: string } {
  const oauth2Client = client()
  if (!oauth2Client) return { error: 'Gmail OAuth is not configured — GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET missing' }
  // access_type:'offline' is what yields a refresh_token; prompt:'consent'
  // forces Google to reissue one even on a repeat connect — Google only
  // grants a refresh token on the FIRST consent per client+account pair otherwise.
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPE.split(' '),
    state,
  })
}

export interface ExchangedGmailTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
  scope: string
  mailboxAddress: string
}

export async function exchangeGmailCode(code: string): Promise<ExchangedGmailTokens | { error: string }> {
  const oauth2Client = client()
  if (!oauth2Client) return { error: 'Gmail OAuth is not configured' }

  try {
    const { tokens } = await oauth2Client.getToken(code)
    if (!tokens.refresh_token) {
      return { error: 'Google did not return a refresh token — try disconnecting and reconnecting' }
    }
    if (!tokens.access_token) return { error: 'Google did not return an access token' }

    let mailboxAddress: string | null = null
    if (tokens.id_token) {
      oauth2Client.setCredentials(tokens)
      const ticket = await oauth2Client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GMAIL_CLIENT_ID })
      mailboxAddress = ticket.getPayload()?.email ?? null
    }
    if (!mailboxAddress) return { error: 'Could not determine the connected Gmail address' }

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000).toISOString(),
      scope: tokens.scope ?? GMAIL_SCOPE,
      mailboxAddress,
    }
  } catch (err) {
    logger.error('Gmail code exchange failed', { module: MOD, error: err })
    return { error: 'Failed to complete Gmail authorization' }
  }
}

// Returns a usable access token, refreshing if the cached one is expired or
// missing. Kept as a pure token operation — does NOT touch connection status
// in the DB on failure; the caller decides what a reauth_required means for
// the send path (see lib/email/reply.ts).
export async function getValidGmailAccessToken(
  connection: EmailOauthConnection
): Promise<string | { error: 'reauth_required' }> {
  const oauth2Client = client()
  if (!oauth2Client) return { error: 'reauth_required' }

  const stillValid =
    connection.access_token &&
    connection.access_token_expires_at &&
    new Date(connection.access_token_expires_at).getTime() > Date.now() + 60_000

  if (stillValid) return connection.access_token as string

  try {
    oauth2Client.setCredentials({ refresh_token: connection.refresh_token })
    const { credentials } = await oauth2Client.refreshAccessToken()
    if (!credentials.access_token) return { error: 'reauth_required' }

    const expiresAt = new Date(credentials.expiry_date ?? Date.now() + 3600_000).toISOString()
    await updateOauthAccessToken(connection.org_id, credentials.access_token, expiresAt)

    return credentials.access_token
  } catch (err) {
    logger.warn('Gmail refresh token is no longer valid', { module: MOD, orgId: connection.org_id, error: err })
    return { error: 'reauth_required' }
  }
}

export async function revokeGmailToken(refreshToken: string): Promise<void> {
  const oauth2Client = client()
  if (!oauth2Client) return
  try {
    await oauth2Client.revokeToken(refreshToken)
  } catch (err) {
    // Best-effort — the connection row is deleted regardless of whether the
    // revoke call itself succeeds.
    logger.warn('Gmail token revoke failed (continuing to delete the connection)', { module: MOD, error: err })
  }
}

function encodeMimeMessage(params: {
  to: string
  from: string
  subject: string
  text: string
  headers: Record<string, string>
}): string {
  const headerLines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    ...Object.entries(params.headers).map(([k, v]) => `${k}: ${v}`),
  ]
  const raw = `${headerLines.join('\r\n')}\r\n\r\n${params.text}`
  return Buffer.from(raw).toString('base64url')
}

export async function sendGmail(
  accessToken: string,
  params: { to: string; from: string; subject: string; text: string; headers: Record<string, string> }
): Promise<{ success: true } | { error: string }> {
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodeMimeMessage(params) }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const body = await res.text()
      logger.error('Gmail send failed', { module: MOD, status: res.status, body })
      return { error: `Gmail API returned ${res.status}` }
    }
    return { success: true }
  } catch (err) {
    logger.error('Gmail send threw', { module: MOD, error: err })
    return { error: 'Gmail send failed' }
  }
}
