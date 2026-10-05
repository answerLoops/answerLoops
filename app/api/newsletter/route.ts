import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSubscriberByEmail, createSubscriber, resubscribe } from '@/lib/db/queries/newsletter'
import { rateLimitShared } from '@/lib/ratelimit'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { clientIp } from '@/lib/http/client-ip'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'
import { sendNewsletterConfirmation } from '@/lib/email/send'

const MOD = 'api/newsletter'

// Public, unauthenticated, pre-auth endpoint that sends an outbound email per
// call, so it carries the same controls as every other route in that class
// (see app/api/widget/lead/route.ts): per-IP rate limit, a body cap, and a
// length-bounded email check.
const IP_MAX = 5
const IP_WINDOW_MS = 60_000

// A newsletter signup is one short email address. 64KB of headroom for the
// JSON envelope is already generous; the address itself is capped far
// tighter below.
const MAX_BODY_BYTES = 64 * 1024

// RFC 5321 caps a path at 254 characters. Anything longer is not an address.
const MAX_EMAIL_CHARS = 254

// Deliberately loose: one @, something either side, no whitespace, a dot in
// the domain. Stricter patterns reject valid addresses, and this is a
// newsletter signup box, not an identity system.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  const ipLimit = await rateLimitShared(`newsletter-ip:${ip}`, IP_MAX, IP_WINDOW_MS)
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

  let unsubscribeToken: string
  try {
    const existing = await getSubscriberByEmail(normalized)
    if (existing && !existing.unsubscribed_at) {
      // Already subscribed — no error, no repeat confirmation email.
      return NextResponse.json({ ok: true, already: true })
    }

    unsubscribeToken = crypto.randomBytes(32).toString('hex')
    if (existing) {
      await resubscribe(normalized, unsubscribeToken)
    } else {
      await createSubscriber({ email: normalized, unsubscribeToken })
    }
  } catch (err) {
    logger.error('newsletter signup failed', { module: MOD, requestId: getRequestId(req), error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  try {
    await sendNewsletterConfirmation(normalized, unsubscribeToken)
  } catch (err) {
    // The subscriber row is already committed — a mail provider hiccup here
    // is not a reason to tell them the signup failed.
    logger.error('newsletter confirmation email failed', {
      module: MOD,
      requestId: getRequestId(req),
      error: err,
    })
  }

  return NextResponse.json({ ok: true })
}
