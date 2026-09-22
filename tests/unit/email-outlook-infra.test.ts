import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Structural/infra assertions for Phase 3 of the email integration redesign:
// Outlook (Microsoft Graph) OAuth send-only connection. Reuses Phase 2's
// email_oauth_connections table (provider column already 'gmail' | 'outlook').

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('outlook OAuth + send wrapper (lib/email/outlook.ts)', () => {
  it('exports buildOutlookAuthUrl, exchangeOutlookCode, getValidOutlookAccessToken, sendOutlook, revokeOutlookToken', async () => {
    const mod = await import('../../lib/email/outlook')
    expect(typeof mod.buildOutlookAuthUrl).toBe('function')
    expect(typeof mod.exchangeOutlookCode).toBe('function')
    expect(typeof mod.getValidOutlookAccessToken).toBe('function')
    expect(typeof mod.sendOutlook).toBe('function')
    expect(typeof mod.revokeOutlookToken).toBe('function')
  })

  it('requests only the Mail.Send scope, not read access', () => {
    const src = readSrc('lib/email/outlook.ts')
    expect(src).toContain('Mail.Send')
    expect(src).not.toContain('Mail.Read')
  })

  it('sends via the draft-then-send flow, not the single-call sendMail endpoint', () => {
    const src = readSrc('lib/email/outlook.ts')
    expect(src).toContain('/me/messages')
    expect(src).toContain('/send')
    expect(src).not.toContain('/me/sendMail')
  })

  it('sets In-Reply-To via the singleValueExtendedProperties MAPI property, best-effort', () => {
    const src = readSrc('lib/email/outlook.ts')
    expect(src).toContain('singleValueExtendedProperties')
    expect(src).toContain('String 0x1042')
  })

  it('reads back the real internetMessageId after sending instead of minting one client-side', () => {
    const src = readSrc('lib/email/outlook.ts')
    expect(src).toContain('internetMessageId')
    expect(src).toContain('readBackInternetMessageId')
  })
})

describe('email-oauth query layer is provider-agnostic (shared with Gmail)', () => {
  it('exports the CRUD + status functions used by both providers', async () => {
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
})

describe('send path: lib/email/reply.ts dispatches oauth sends by provider', () => {
  it('branches to sendViaOutlook when connection.provider is outlook', () => {
    const src = readSrc('lib/email/reply.ts')
    expect(src).toContain("connection.provider === 'outlook'")
    expect(src).toContain('sendViaOutlook(connection')
  })

  it('does not set a References header for Outlook sends (Graph cannot carry it)', () => {
    const src = readSrc('lib/email/reply.ts')
    const fnStart = src.indexOf('async function sendViaOutlook')
    const fnBody = src.slice(fnStart, fnStart + 1500)
    expect(fnBody).toContain('references: null')
  })

  it('notifies admins with the correct provider label on a dead Outlook token', () => {
    const src = readSrc('lib/email/reply.ts')
    const fnStart = src.indexOf('async function sendViaOutlook')
    const fnBody = src.slice(fnStart, fnStart + 800)
    expect(fnBody).toContain("notifyAdminsOauthDisconnected(orgId, 'outlook')")
  })
})

describe('server actions + routes: Outlook connect/disconnect flow', () => {
  it('disconnectOauthAction branches on provider to call the right revoke function', () => {
    const src = readSrc('lib/actions/integrations.ts')
    expect(src).toContain('export async function disconnectOauthAction')
    const fnStart = src.indexOf('export async function disconnectOauthAction')
    const fnBody = src.slice(fnStart, fnStart + 800)
    expect(fnBody).toContain("existing.provider === 'outlook'")
    expect(fnBody).toContain('revokeOutlookToken(existing.refresh_token)')
    expect(fnBody).toContain('revokeGmailToken(existing.refresh_token)')
  })

  it('install route mints a signed state for the caller org and requires membership', () => {
    const src = readSrc('app/api/email/outlook/install/route.ts')
    expect(src).toContain('buildOutlookAuthUrl')
    expect(src).toContain('requireOrgAccess()')
    expect(src).toContain('signOAuthState({ orgId: access.orgId })')
    expect(src).not.toContain('DEFAULT_ORG_ID')
  })

  it('callback route authenticates the state, binds it to the caller org, then upserts provider outlook', () => {
    const src = readSrc('app/api/email/outlook/callback/route.ts')
    expect(src).toContain('verifyOAuthState(state)')
    expect(src).toContain('decoded.orgId !== access.orgId')
    expect(src).not.toContain("Buffer.from(state ?? '', 'base64url')")
    expect(src).toContain('upsertEmailOauthConnection')
    expect(src).toContain("provider: 'outlook'")
    expect(src).toContain("emailSendMethod: 'oauth'")
  })
})

describe('UI: EmailOauthSection is provider-aware', () => {
  it('offers both Connect Gmail and Connect Outlook when no connection exists', () => {
    const src = readSrc('components/settings/email.tsx')
    const fnStart = src.indexOf('function EmailOauthSection')
    const fnBody = src.slice(fnStart, fnStart + 3000)
    expect(fnBody).toContain('/api/email/gmail/install')
    expect(fnBody).toContain('/api/email/outlook/install')
  })
})
