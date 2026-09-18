import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/drizzle'
import { waitlist } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { sendWaitlistConfirmation } from '@/lib/email/send'
import { rateLimitShared } from '@/lib/ratelimit'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { clientIp } from '@/lib/http/client-ip'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/waitlist'

// Public, unauthenticated, pre-auth endpoint that sends an outbound email per
// call — same abuse class as the widget lead endpoint, so it carries the same
// controls: per-IP rate limit, a body cap, and a length-bounded email check.
const IP_MAX = 5
const IP_WINDOW_MS = 60_000

// A waitlist signup is one short email address. 64KB of headroom for the JSON
// envelope is already generous; the address itself is capped far tighter below.
const MAX_BODY_BYTES = 64 * 1024

// RFC 5321 caps a path at 254 characters. Anything longer is not an address.
const MAX_EMAIL_CHARS = 254

// Deliberately loose: one @, something either side, no whitespace, a dot in the
// domain. Stricter patterns reject valid addresses, and this is a waitlist
// signup box, not an identity system.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  const ipLimit = await rateLimitShared(`waitlist-ip:${ip}`, IP_MAX, IP_WINDOW_MS)
  if (!ipLimit.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const raw = await readBodyCapped(req, MAX_BODY_BYTES)
  if (raw === null) return NextResponse.json({ error: 'Request body too large' }, { status: 413 })

  let body: { email?: string }
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const { email } = body
  if (typeof email !== 'string') {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }
  const normalized = email.trim().toLowerCase()
  if (normalized.length > MAX_EMAIL_CHARS || !EMAIL_PATTERN.test(normalized)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  try {
    const db = await getDb()

    const existing = await db.select().from(waitlist).where(eq(waitlist.email, normalized)).limit(1)
    if (existing.length > 0) {
      return NextResponse.json({ ok: true, already: true })
    }

    await db.insert(waitlist).values({ email: normalized })
  } catch (err) {
    logger.error('waitlist signup failed', { module: MOD, requestId: getRequestId(req), error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  try {
    await sendWaitlistConfirmation(normalized)
  } catch (err) {
    logger.error('waitlist confirmation email failed', { module: MOD, requestId: getRequestId(req), error: err })
  }

  return NextResponse.json({ ok: true })
}
