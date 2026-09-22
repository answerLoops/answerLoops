import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Structural/infra assertions for Phase 1 of the email integration redesign:
// verified custom-domain sending via Resend. See lib/db/schema.ts's
// emailDomains table + integrations.emailSendMethod doc comments.

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('schema: emailDomains + integrations.emailSendMethod', () => {
  it('defines the emailDomains table with the verification-flow columns', async () => {
    const { emailDomains } = await import('../../lib/db/schema')
    const cols = emailDomains as unknown as Record<string, unknown>
    for (const col of [
      'orgId',
      'domain',
      'provider',
      'providerDomainId',
      'dkimRecordName',
      'dkimRecordValue',
      'returnPathRecordName',
      'returnPathRecordValue',
      'receivingRecordName',
      'receivingRecordValue',
      'receivingRecordPriority',
      'dmarcSuggestion',
      'status',
      'lastCheckedAt',
      'verifiedAt',
    ]) {
      expect(cols, col).toHaveProperty(col)
    }
  })

  it('defines emailSendMethod on the integrations table', async () => {
    const { integrations } = await import('../../lib/db/schema')
    const cols = integrations as unknown as Record<string, unknown>
    expect(cols).toHaveProperty('emailSendMethod')
  })

  it('migration file creates email_domains and adds email_send_method', () => {
    const sql = readSrc('drizzle/0031_email_domains.sql')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS email_send_method TEXT NOT NULL DEFAULT 'platform'/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS email_domains/)
    expect(sql).toMatch(/org_id INTEGER NOT NULL UNIQUE REFERENCES orgs\(id\)/)
  })
})

describe('resend domains wrapper (lib/email/domain.ts)', () => {
  it('exports registerDomain, checkDomainStatus, removeDomain', async () => {
    const mod = await import('../../lib/email/domain')
    expect(typeof mod.registerDomain).toBe('function')
    expect(typeof mod.checkDomainStatus).toBe('function')
    expect(typeof mod.removeDomain).toBe('function')
  })

  it('maps Resend SPF records to the return-path field (Resend has no literal "return path" record type)', () => {
    const src = readSrc('lib/email/domain.ts')
    expect(src).toContain("r.record === 'SPF'")
    expect(src).toContain("r.record === 'DKIM'")
    expect(src).toContain("r.record === 'Receiving'")
    expect(src).toContain('receivingRecord.name, value: receivingRecord.value')
  })

  it('explains when Resend rejects a domain because it is already registered', () => {
    const src = readSrc('lib/email/domain.ts')
    expect(src).toContain('registered already')
    expect(src).toContain('Use a different domain')
  })

  it('guards every call against a missing RESEND_API_KEY / MOCK_EXTERNALS', () => {
    const src = readSrc('lib/email/domain.ts')
    const guardCount = (src.match(/MOCK_EXTERNALS \|\| !process\.env\.RESEND_API_KEY/g) ?? []).length
    expect(guardCount).toBeGreaterThanOrEqual(3)
  })
})

describe('email-domains query layer', () => {
  it('exports the CRUD functions', async () => {
    const q = await import('../../lib/db/queries/email-domains')
    for (const fn of ['getEmailDomain', 'getEmailDomainByDomain', 'upsertEmailDomain', 'updateEmailDomainStatus', 'deleteEmailDomain']) {
      expect(typeof (q as Record<string, unknown>)[fn], fn).toBe('function')
    }
  })
})

describe('inbound receiving path', () => {
  it('registers Resend receiving and routes signed email.received events by domain', () => {
    const domain = readSrc('lib/email/domain.ts')
    const route = readSrc('app/api/email/ingest/route.ts')
    expect(domain).toContain("receiving: 'enabled'")
    expect(route).toContain("eventType !== 'email.received'")
    expect(route).toContain('getEmailDomainByDomain(recipientDomain)')
    expect(route).toContain('emails.receiving.get(emailId)')
  })
})

describe('send path: lib/email/reply.ts branches on email_send_method', () => {
  it('uses the verified domain when email_send_method is "domain"', () => {
    const src = readSrc('lib/email/reply.ts')
    expect(src).toContain("integration?.email_send_method === 'domain'")
    expect(src).toContain('getEmailDomain(orgId)')
    expect(src).toContain("fromAddress = `noreply@${domainRow.domain}`")
  })

  it('falls back to RESEND_FROM when the domain is not verified yet', () => {
    const src = readSrc('lib/email/reply.ts')
    const idx = src.indexOf("integration?.email_send_method === 'domain'")
    const body = src.slice(idx, idx + 700)
    expect(body).toContain("process.env.RESEND_FROM ?? 'support@yourdomain.com'")
  })
})

describe('server actions: domain verification flow', () => {
  const src = () => readSrc('lib/actions/integrations.ts')

  it('exports start/check/remove domain actions', () => {
    const s = src()
    expect(s).toContain('export async function startEmailDomainVerificationAction')
    expect(s).toContain('export async function checkEmailDomainVerificationAction')
    expect(s).toContain('export async function removeEmailDomainAction')
  })

  it('the free-text reply-from override is gone from saveEmailIntegrationAction', () => {
    const s = src()
    const fnStart = s.indexOf('export async function saveEmailIntegrationAction')
    const fnEnd = s.indexOf('export async function deleteEmailIntegrationAction')
    const fnBody = s.slice(fnStart, fnEnd)
    expect(fnBody).not.toContain('replyFromAddress')
    expect(fnBody).not.toContain('botToken:')
  })

  it('startEmailDomainVerificationAction is idempotent on repeat submits', () => {
    const s = src()
    const fnStart = s.indexOf('export async function startEmailDomainVerificationAction')
    const fnEnd = s.indexOf('export async function checkEmailDomainVerificationAction')
    const fnBody = s.slice(fnStart, fnEnd)
    expect(fnBody).toContain('existing?.provider_domain_id')
  })

  it('checkEmailDomainVerificationAction flips emailSendMethod to domain once verified', () => {
    const s = src()
    const fnStart = s.indexOf('export async function checkEmailDomainVerificationAction')
    const fnEnd = s.indexOf('export async function removeEmailDomainAction')
    const fnBody = s.slice(fnStart, fnEnd)
    expect(fnBody).toContain("status === 'verified'")
    expect(fnBody).toContain("emailSendMethod: 'domain'")
  })

  it('removeEmailDomainAction falls back emailSendMethod to platform', () => {
    const s = src()
    const fnStart = s.indexOf('export async function removeEmailDomainAction')
    const fnBody = s.slice(fnStart, fnStart + 800)
    expect(fnBody).toContain("emailSendMethod: 'platform'")
  })
})

describe('API route: app/api/email-domain/route.ts', () => {
  it('requires auth and returns the org-scoped domain row', () => {
    const src = readSrc('app/api/email-domain/route.ts')
    expect(src).toContain('await auth()')
    expect(src).toContain('getEmailDomain(orgId)')
  })
})
