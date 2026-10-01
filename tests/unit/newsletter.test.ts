import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The blog newsletter signup endpoint is public, unauthenticated, and writes
// a caller-supplied email address straight into a new table. Same abuse class
// as the waitlist signup box, so it carries the same controls: a per-IP rate
// limit via lib/ratelimit's rateLimitShared, a capped body read via
// readBodyCapped, and a length-bounded, shape-checked address — see
// tests/unit/waitlist-abuse-hardening.test.ts, which this mirrors.
//
// Next.js route modules cannot be imported in vitest (same constraint noted
// in tests/unit/circle-webhook-route.test.ts and
// tests/unit/discourse-webhook-route.test.ts), so the route behavior is
// locked in via source-file structural assertions rather than an invoked
// handler with a mocked DB client.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('drizzle/0044_newsletter_subscribers.sql', () => {
  const file = path.join(ROOT, 'drizzle/0044_newsletter_subscribers.sql')

  it('exists and is non-empty', () => {
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file, 'utf-8').trim().length).toBeGreaterThan(0)
  })

  it('creates the newsletter_subscribers table', () => {
    const sql = fs.readFileSync(file, 'utf-8')
    expect(sql).toMatch(/CREATE TABLE(\s+IF NOT EXISTS)?\s+newsletter_subscribers/i)
  })

  it('defines email as UNIQUE and NOT NULL', () => {
    const sql = fs.readFileSync(file, 'utf-8')
    // Match the email column line specifically, not just any UNIQUE/NOT NULL
    // elsewhere in the file.
    const emailLine = sql.split('\n').find((l) => /^\s*email\s/i.test(l))
    expect(emailLine, 'no email column line found').toBeDefined()
    expect(emailLine).toMatch(/NOT NULL/i)
    expect(emailLine).toMatch(/UNIQUE/i)
  })
})

describe('drizzle/0045_newsletter_unsubscribe.sql', () => {
  const file = path.join(ROOT, 'drizzle/0045_newsletter_unsubscribe.sql')

  it('exists and adds the unsubscribe token + unsubscribed_at columns', () => {
    expect(fs.existsSync(file)).toBe(true)
    const sql = fs.readFileSync(file, 'utf-8')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS unsubscribe_token/i)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS unsubscribed_at/i)
  })
})

describe('lib/db/schema.ts: newsletterSubscribers', () => {
  it('exports a newsletterSubscribers table distinct from waitlist', async () => {
    const schema = await import('../../lib/db/schema')
    expect(schema).toHaveProperty('newsletterSubscribers')
    expect(schema).toHaveProperty('waitlist')
    expect(schema.newsletterSubscribers).not.toBe(schema.waitlist as unknown as typeof schema.newsletterSubscribers)
  })

  it('maps to the newsletter_subscribers table with an email column', () => {
    const schemaSrc = read('lib/db/schema.ts')
    const tableIdx = schemaSrc.indexOf("pgTable(\n  'newsletter_subscribers'")
    expect(tableIdx).toBeGreaterThan(-1)
    // The waitlist table definition must be a separate block, not reused.
    const waitlistIdx = schemaSrc.indexOf("pgTable('waitlist'")
    expect(waitlistIdx).toBeGreaterThan(-1)
    expect(tableIdx).not.toBe(waitlistIdx)
  })

  it('carries an unsubscribe token distinct from the email column', () => {
    const schemaSrc = read('lib/db/schema.ts')
    expect(schemaSrc).toContain("unsubscribeToken: text('unsubscribe_token')")
    expect(schemaSrc).toContain("unsubscribedAt: text('unsubscribed_at')")
  })
})

describe('lib/db/queries/newsletter.ts', () => {
  it('exposes signup, resubscribe, and unsubscribe-by-token helpers', async () => {
    const queries = await import('../../lib/db/queries/newsletter')
    expect(queries).toHaveProperty('getSubscriberByEmail')
    expect(queries).toHaveProperty('createSubscriber')
    expect(queries).toHaveProperty('resubscribe')
    expect(queries).toHaveProperty('getSubscriberByUnsubscribeToken')
    expect(queries).toHaveProperty('unsubscribeByToken')
  })
})

describe('newsletter route carries the same abuse controls as waitlist', () => {
  it('uses the shared limiter and capped body reader instead of no controls', () => {
    const src = read('app/api/newsletter/route.ts')
    expect(src).toContain("import { rateLimitShared } from '@/lib/ratelimit'")
    expect(src).toContain("import { readBodyCapped } from '@/lib/http/read-body-capped'")
    expect(src).toContain("import { clientIp } from '@/lib/http/client-ip'")
  })

  it('rate-limits by IP before reading the body', () => {
    const src = read('app/api/newsletter/route.ts')
    const limitIdx = src.indexOf('rateLimitShared(`newsletter-ip:')
    const bodyIdx = src.indexOf('readBodyCapped(req')
    expect(limitIdx).toBeGreaterThan(-1)
    expect(bodyIdx).toBeGreaterThan(-1)
    expect(bodyIdx).toBeGreaterThan(limitIdx)
  })

  it('rejects with 429 when the limiter trips and 413 when the body is too large', () => {
    const src = read('app/api/newsletter/route.ts')
    expect(src).toContain('status: 429')
    expect(src).toContain('status: 413')
  })

  it('bounds the email address by length and shape instead of a bare @ check', () => {
    const src = read('app/api/newsletter/route.ts')
    expect(src).toContain('const MAX_EMAIL_CHARS = 254')
    const capIdx = src.indexOf('normalized.length > MAX_EMAIL_CHARS')
    const patternIdx = src.indexOf('EMAIL_PATTERN.test(normalized)')
    expect(capIdx).toBeGreaterThan(-1)
    expect(patternIdx).toBeGreaterThan(-1)
  })

  it('checks for an existing subscriber before inserting and returns already:true instead of a duplicate insert', () => {
    const src = read('app/api/newsletter/route.ts')
    const existingIdx = src.indexOf('getSubscriberByEmail(normalized)')
    const alreadyIdx = src.indexOf('{ ok: true, already: true }')
    const insertIdx = src.indexOf('createSubscriber({ email: normalized')
    expect(existingIdx).toBeGreaterThan(-1)
    expect(alreadyIdx).toBeGreaterThan(-1)
    expect(insertIdx).toBeGreaterThan(-1)
    // The already-subscribed short-circuit must return before the insert runs.
    expect(alreadyIdx).toBeLessThan(insertIdx)
  })

  it('resubscribes an unsubscribed row instead of erroring on the unique email', () => {
    const src = read('app/api/newsletter/route.ts')
    expect(src).toContain('!existing.unsubscribed_at')
    expect(src).toContain('await resubscribe(normalized, unsubscribeToken)')
  })

  it('creates a subscriber with a fresh unsubscribe token and returns ok:true on success', () => {
    const src = read('app/api/newsletter/route.ts')
    expect(src).toContain("unsubscribeToken = crypto.randomBytes(32).toString('hex')")
    expect(src).toContain('return NextResponse.json({ ok: true })')
  })

  it('sends a confirmation email but never fails the signup if it throws', () => {
    const src = read('app/api/newsletter/route.ts')
    expect(src).toContain("import { sendNewsletterConfirmation } from '@/lib/email/send'")
    const sendIdx = src.indexOf('await sendNewsletterConfirmation(normalized, unsubscribeToken)')
    const catchIdx = src.indexOf('newsletter confirmation email failed')
    const finalOkIdx = src.lastIndexOf('return NextResponse.json({ ok: true })')
    expect(sendIdx).toBeGreaterThan(-1)
    expect(catchIdx).toBeGreaterThan(sendIdx)
    expect(finalOkIdx).toBeGreaterThan(sendIdx)
  })

  it('returns 400 for a non-string or malformed email, and 500 on a DB failure', () => {
    const src = read('app/api/newsletter/route.ts')
    expect(src).toContain("status: 400")
    expect(src).toContain("status: 500")
    expect(src).toContain("typeof email !== 'string'")
  })
})

describe('auth.ts PUBLIC_PATHS includes /api/newsletter and /unsubscribe', () => {
  it('are both present in the PUBLIC_PATHS allowlist', () => {
    const authSrc = read('auth.ts')
    const match = authSrc.match(/const PUBLIC_PATHS = \[([\s\S]*?)\]/)
    expect(match, 'Could not find PUBLIC_PATHS in auth.ts').not.toBeNull()
    const publicPaths = match![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    expect(publicPaths).toContain('/api/newsletter')
    expect(publicPaths).toContain('/unsubscribe')
  })
})

describe('lib/marketing/website-paths.ts WEBSITE_PATHS includes /unsubscribe', () => {
  it('is present so the unsubscribe page stays on the marketing host instead of 307ing to /login on the app subdomain', () => {
    const websitePathsSrc = read('lib/marketing/website-paths.ts')
    const match = websitePathsSrc.match(/export const WEBSITE_PATHS = \[([\s\S]*?)\] as const/)
    expect(match, 'Could not find WEBSITE_PATHS in lib/marketing/website-paths.ts').not.toBeNull()
    const websitePaths = match![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    expect(websitePaths).toContain('/unsubscribe')
  })
})

describe('app/unsubscribe/page.tsx', () => {
  it('awaits the token search param and unsubscribes by token', () => {
    const src = read('app/unsubscribe/page.tsx')
    expect(src).toContain("import { unsubscribeByToken } from '@/lib/db/queries/newsletter'")
    expect(src).toContain('searchParams: Promise<{ token?: string }>')
    expect(src).toContain('await searchParams')
    expect(src).toContain('unsubscribeByToken(token)')
  })
})

describe('lib/email/send.ts: sendNewsletterConfirmation', () => {
  it('is signed from Nathan and links to the unsubscribe page with the token', () => {
    const src = read('lib/email/send.ts')
    const fnIdx = src.indexOf('export async function sendNewsletterConfirmation')
    expect(fnIdx).toBeGreaterThan(-1)
    const fnSrc = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnSrc).toContain('Nathan, Founder of answerLoops')
    expect(fnSrc).toContain('/unsubscribe?token=')
    expect(fnSrc).toContain('RESEND_NEWSLETTER_FROM')
  })

  it('is a no-op without a Resend API key, same as the other transactional emails', () => {
    const src = read('lib/email/send.ts')
    const fnIdx = src.indexOf('export async function sendNewsletterConfirmation')
    const fnSrc = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnSrc).toContain('if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) return')
  })
})
