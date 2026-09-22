import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Structural/infra assertions for Phase 2 of the email integration redesign:
// Gmail OAuth send-only connection. See lib/db/schema.ts's
// emailOauthConnections table doc comment.

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('schema: emailOauthConnections', () => {
  it('defines the emailOauthConnections table with the token/status columns', async () => {
    const { emailOauthConnections } = await import('../../lib/db/schema')
    const cols = emailOauthConnections as unknown as Record<string, unknown>
    for (const col of [
      'orgId',
      'provider',
      'mailboxAddress',
      'accessToken',
      'accessTokenExpiresAt',
      'refreshToken',
      'grantedScope',
      'status',
      'disconnectedAt',
    ]) {
      expect(cols, col).toHaveProperty(col)
    }
  })

  it('migration file creates email_oauth_connections with a required refresh_token', () => {
    const sql = readSrc('drizzle/0032_email_gmail_oauth.sql')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS email_oauth_connections/)
    expect(sql).toMatch(/refresh_token TEXT NOT NULL/)
    expect(sql).toMatch(/org_id INTEGER NOT NULL UNIQUE REFERENCES orgs\(id\)/)
  })
})

describe('gmail OAuth + send wrapper (lib/email/gmail.ts)', () => {
  it('exports buildGmailAuthUrl, exchangeGmailCode, getValidGmailAccessToken, sendGmail, revokeGmailToken', async () => {
    const mod = await import('../../lib/email/gmail')
    expect(typeof mod.buildGmailAuthUrl).toBe('function')
    expect(typeof mod.exchangeGmailCode).toBe('function')
    expect(typeof mod.getValidGmailAccessToken).toBe('function')
    expect(typeof mod.sendGmail).toBe('function')
    expect(typeof mod.revokeGmailToken).toBe('function')
  })

  it('requests only the gmail.send scope, not full mailbox read access', () => {
    const src = readSrc('lib/email/gmail.ts')
    expect(src).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(src).not.toContain('gmail.readonly')
    expect(src).not.toContain('gmail.modify')
  })
})

describe('email-oauth query layer', () => {
  it('exports the CRUD + status functions', async () => {
    const q = await import('../../lib/db/queries/email-oauth')
    for (const fn of [
      'getEmailOauthConnection',
      'upsertEmailOauthConnection',
      'updateOauthAccessToken',
      'markEmailOauthDisconnected',
      'deleteEmailOauthConnection',
    ]) {
      expect(typeof (q as Record<string, unknown>)[fn], fn).toBe('function')
    }
  })

  it('encrypts access_token and refresh_token through lib/crypto/tokens on write', () => {
    const src = readSrc('lib/db/queries/email-oauth.ts')
    expect(src).toContain('encryptToken(input.accessToken)')
    expect(src).toContain('encryptToken(input.refreshToken)')
  })
})

describe('send path: lib/email/reply.ts branches on email_send_method === oauth', () => {
  it('tries Gmail first, never returns early before RESEND_API_KEY is even checked', () => {
    const src = readSrc('lib/email/reply.ts')
    const oauthIdx = src.indexOf("integration?.email_send_method === 'oauth'")
    const apiKeyIdx = src.indexOf('const apiKey = process.env.RESEND_API_KEY')
    expect(oauthIdx).toBeGreaterThan(-1)
    expect(apiKeyIdx).toBeGreaterThan(-1)
    expect(oauthIdx).toBeLessThan(apiKeyIdx)
  })

  it('flips the connection to disconnected and notifies admins on a dead refresh token', () => {
    const src = readSrc('lib/email/reply.ts')
    expect(src).toContain('markEmailOauthDisconnected(orgId)')
    expect(src).toContain("notifyAdminsOauthDisconnected(orgId, 'gmail')")
  })

  it('falls back to the Resend path instead of returning null on Gmail failure', () => {
    const src = readSrc('lib/email/reply.ts')
    const oauthBlockStart = src.indexOf("integration?.email_send_method === 'oauth'")
    const oauthBlockEnd = src.indexOf('const apiKey = process.env.RESEND_API_KEY')
    const oauthBlock = src.slice(oauthBlockStart, oauthBlockEnd)
    expect(oauthBlock).not.toContain('return null') // only `if (sent) return sent` — anything else falls through
  })
})

describe('server actions + routes: Gmail connect/disconnect flow', () => {
  it('exports disconnectOauthAction (shared with Outlook — see email-outlook-infra.test.ts), revoking Gmail best-effort before deleting the row', () => {
    const src = readSrc('lib/actions/integrations.ts')
    expect(src).toContain('export async function disconnectOauthAction')
    const fnStart = src.indexOf('export async function disconnectOauthAction')
    const fnBody = src.slice(fnStart, fnStart + 800)
    expect(fnBody).toContain('revokeGmailToken(existing.refresh_token)')
    expect(fnBody).toContain("emailSendMethod: 'platform'")
  })

  it('install route redirects to the Gmail consent screen with signed state', () => {
    const src = readSrc('app/api/email/gmail/install/route.ts')
    expect(src).toContain('buildGmailAuthUrl')
    expect(src).toContain('base64url')
    expect(src).toContain('answerloops-gmail-oauth-state')
    expect(src).toContain('httpOnly: true')
  })

  it('callback route validates state expiry and upserts the connection + send method', () => {
    const src = readSrc('app/api/email/gmail/callback/route.ts')
    expect(src).toContain('10 * 60 * 1000')
    expect(src).toContain('stateCookie')
    expect(src).toContain('state mismatch')
    expect(src).toContain('upsertEmailOauthConnection')
    expect(src).toContain("emailSendMethod: 'oauth'")
  })
})

describe('API route: app/api/email-oauth/route.ts', () => {
  it('requires auth and never returns access_token/refresh_token to the client', () => {
    const src = readSrc('app/api/email-oauth/route.ts')
    expect(src).toContain('await auth()')
    expect(src).toContain('_at, refresh_token: _rt')
  })
})
