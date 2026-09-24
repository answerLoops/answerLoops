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

describe('lib/db/schema.ts: newsletterSubscribers', () => {
  it('exports a newsletterSubscribers table distinct from waitlist', async () => {
    const schema = await import('../../lib/db/schema')
    expect(schema).toHaveProperty('newsletterSubscribers')
    expect(schema).toHaveProperty('waitlist')
    expect(schema.newsletterSubscribers).not.toBe(schema.waitlist as unknown as typeof schema.newsletterSubscribers)
  })

  it('maps to the newsletter_subscribers table with an email column', () => {
    const schemaSrc = read('lib/db/schema.ts')
    const tableIdx = schemaSrc.indexOf("pgTable('newsletter_subscribers'")
    expect(tableIdx).toBeGreaterThan(-1)
    // The waitlist table definition must be a separate block, not reused.
    const waitlistIdx = schemaSrc.indexOf("pgTable('waitlist'")
    expect(waitlistIdx).toBeGreaterThan(-1)
    expect(tableIdx).not.toBe(waitlistIdx)
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
    const existingIdx = src.indexOf('.where(eq(newsletterSubscribers.email, normalized))')
    const alreadyIdx = src.indexOf('{ ok: true, already: true }')
    const insertIdx = src.indexOf('db.insert(newsletterSubscribers)')
    expect(existingIdx).toBeGreaterThan(-1)
    expect(alreadyIdx).toBeGreaterThan(-1)
    expect(insertIdx).toBeGreaterThan(-1)
    // The already-subscribed short-circuit must return before the insert runs.
    expect(alreadyIdx).toBeLessThan(insertIdx)
  })

  it('inserts into newsletterSubscribers and returns ok:true on success', () => {
    const src = read('app/api/newsletter/route.ts')
    expect(src).toContain('await db.insert(newsletterSubscribers).values({ email: normalized })')
    expect(src).toContain('return NextResponse.json({ ok: true })')
  })

  it('returns 400 for a non-string or malformed email, and 500 on a DB failure', () => {
    const src = read('app/api/newsletter/route.ts')
    expect(src).toContain("status: 400")
    expect(src).toContain("status: 500")
    expect(src).toContain("typeof email !== 'string'")
  })
})

describe('auth.ts PUBLIC_PATHS includes /api/newsletter', () => {
  it('is present in the PUBLIC_PATHS allowlist', () => {
    const authSrc = read('auth.ts')
    const match = authSrc.match(/const PUBLIC_PATHS = \[([\s\S]*?)\]/)
    expect(match, 'Could not find PUBLIC_PATHS in auth.ts').not.toBeNull()
    const publicPaths = match![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    expect(publicPaths).toContain('/api/newsletter')
  })
})
